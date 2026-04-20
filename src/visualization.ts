import axios from "axios";
import { google } from "googleapis";
import { Readable } from "stream";
import puppeteer from "puppeteer-core";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChartDataset {
  label: string;
  values: number[];
}

export interface CreateChartInput {
  title: string;
  chart_type: "bar" | "line" | "pie";
  labels: string[];
  datasets: ChartDataset[];
  description?: string;
}

export interface CreateTableInput {
  title: string;
  columns: string[];
  rows: string[][];
  description?: string;
}

export interface VisualizationResult {
  drive_url: string;
  chart_id: string;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

const MAX_CACHE = 50;

const visualizationCache = new Map<string, {
  buffer: Buffer;
  driveUrl: string;
  title: string;
  type: "chart" | "table";
}>();

function generateChartId(): string {
  return `chart_${Date.now()}`;
}

function pruneCache(): void {
  if (visualizationCache.size >= MAX_CACHE) {
    const oldest = visualizationCache.keys().next().value;
    if (oldest) visualizationCache.delete(oldest);
  }
}

// ── Google Drive ──────────────────────────────────────────────────────────────

async function uploadToDrive(buffer: Buffer, filename: string): Promise<string> {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID!],
      mimeType: "image/png",
    },
    media: {
      mimeType: "image/png",
      body: Readable.from(buffer),
    },
    fields: "id",
  });

  const fileId = res.data.id;
  if (!fileId) throw new Error("Drive upload returned no file ID");

  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

// ── Chart rendering (QuickChart.io) ───────────────────────────────────────────

const CHART_COLORS = ["#4f9cf9", "#f97b4f", "#4ff9a0", "#f9e34f", "#c44fff"];

function buildChartConfig(input: CreateChartInput): object {
  const { title, chart_type, labels, datasets } = input;

  const baseOptions = {
    plugins: {
      title: {
        display: true,
        text: title,
        color: "#ffffff",
        font: { size: 18, weight: "bold" as const },
        padding: { bottom: 16 },
      },
      legend: {
        labels: { color: "#cccccc", font: { size: 13 } },
      },
    },
    layout: { padding: 20 },
  };

  if (chart_type === "pie") {
    if (datasets.length > 1) {
      throw new Error("Pie charts only support a single dataset. Pass one dataset with all values.");
    }
    const total = datasets[0].values.reduce((a, b) => a + b, 0);
    return {
      type: "pie",
      data: {
        labels,
        datasets: [
          {
            data: datasets[0].values,
            backgroundColor: CHART_COLORS.slice(0, datasets[0].values.length),
            borderWidth: 2,
            borderColor: "#0f1117",
          },
        ],
      },
      options: {
        ...baseOptions,
        plugins: {
          ...baseOptions.plugins,
          datalabels: {
            color: "#ffffff",
            font: { weight: "bold" as const, size: 12 },
            formatter: (value: number) =>
              total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "",
          },
        },
      },
    };
  }

  if (chart_type === "line") {
    return {
      type: "line",
      data: {
        labels,
        datasets: datasets.map((ds, i) => ({
          label: ds.label,
          data: ds.values,
          borderColor: CHART_COLORS[i % CHART_COLORS.length],
          backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + "33",
          pointBackgroundColor: CHART_COLORS[i % CHART_COLORS.length],
          tension: 0.3,
          fill: false,
          borderWidth: 2,
          pointRadius: 4,
        })),
      },
      options: {
        ...baseOptions,
        plugins: {
          ...baseOptions.plugins,
          datalabels: {
            anchor: "end",
            align: "top",
            color: "#ffffff",
            font: { weight: "bold" as const, size: 10 },
            formatter: (v: number) => (v === 0 ? "" : v.toLocaleString()),
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(255,255,255,0.05)" },
            ticks: { color: "#aaaaaa" },
          },
          y: {
            grid: { color: "rgba(255,255,255,0.08)" },
            ticks: { color: "#aaaaaa" },
          },
        },
      },
    };
  }

  // bar (default)
  return {
    type: "bar",
    data: {
      labels,
      datasets: datasets.map((ds, i) => ({
        label: ds.label,
        data: ds.values,
        backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
        borderRadius: 6,
        borderSkipped: false,
      })),
    },
    options: {
      ...baseOptions,
      plugins: {
        ...baseOptions.plugins,
        datalabels: {
          anchor: "end",
          align: "top",
          color: "#ffffff",
          font: { weight: "bold" as const, size: 11 },
          formatter: (v: number) => (v === 0 ? "" : v.toLocaleString()),
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: { color: "#aaaaaa" },
        },
        y: {
          grid: { color: "rgba(255,255,255,0.08)" },
          ticks: { color: "#aaaaaa" },
        },
      },
    },
  };
}

async function renderChart(input: CreateChartInput): Promise<Buffer> {
  const chartConfig = buildChartConfig(input);

  const response = await axios.post(
    "https://quickchart.io/chart",
    {
      width: 900,
      height: 500,
      devicePixelRatio: 2,
      format: "png",
      backgroundColor: "#0f1117",
      chart: chartConfig,
    },
    { responseType: "arraybuffer" }
  );

  if (response.status !== 200) {
    throw new Error(`QuickChart.io returned status ${response.status}`);
  }

  return Buffer.from(response.data);
}

// ── Table rendering (Puppeteer) ───────────────────────────────────────────────

function isNumeric(val: string): boolean {
  return val.trim() !== "" && !isNaN(Number(val.replace(/,/g, "")));
}

function buildTableHtml(input: CreateTableInput): string {
  const { title, columns, rows, description } = input;

  const headerCells = columns
    .map((col, i) => `<th class="${i > 0 ? "num" : ""}">${col}</th>`)
    .join("");

  const bodyRows = rows
    .map((row, rowIdx) => {
      const cells = row
        .map((cell, colIdx) => {
          const numeric = colIdx > 0 && isNumeric(cell);
          const cls = numeric ? "num" : colIdx === 0 ? "name" : "";
          return `<td class="${cls}">${cell}</td>`;
        })
        .join("");
      return `<tr class="${rowIdx % 2 === 0 ? "even" : "odd"}">${cells}</tr>`;
    })
    .join("");

  const footer = description ?? `${rows.length} row${rows.length !== 1 ? "s" : ""}`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0f1117;
    display: flex;
    justify-content: center;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  .card {
    background: #1a1f2e;
    border-radius: 12px;
    overflow: hidden;
    width: 900px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
  }
  .card-header {
    background: #151b29;
    border-bottom: 2px solid #4f9cf9;
    padding: 16px 24px;
  }
  .card-header h2 {
    color: #ffffff;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.3px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  thead th {
    background: #0f1419;
    color: #4f9cf9;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 10px 16px;
    text-align: left;
    border-bottom: 1px solid rgba(79,156,249,0.3);
  }
  thead th.num { text-align: right; }
  tr.even td { background: #1a1f2e; }
  tr.odd td  { background: #151b29; }
  td {
    color: #e0e0e0;
    font-size: 13px;
    padding: 9px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  td.name { color: #ffffff; font-weight: 500; }
  td.num  {
    text-align: right;
    font-family: "SF Mono", "Fira Code", "Courier New", monospace;
    color: #f0f0f0;
  }
  .footer {
    color: #555e7a;
    font-size: 11px;
    padding: 10px 24px;
    text-align: right;
    background: #151b29;
    border-top: 1px solid rgba(255,255,255,0.05);
  }
</style>
</head>
<body>
  <div class="card">
    <div class="card-header"><h2>${title}</h2></div>
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    <div class="footer">${footer}</div>
  </div>
</body>
</html>`;
}

async function renderTable(input: CreateTableInput): Promise<Buffer> {
  const html = buildTableHtml(input);

  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ?? "/usr/bin/chromium-browser";

  const browser = await puppeteer.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 800, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });

    const element = await page.$(".card");
    if (!element) throw new Error("Table card element not found in rendered HTML");

    const screenshot = await element.screenshot({ type: "png" });
    return Buffer.from(screenshot);
  } finally {
    await browser.close();
  }
}

// ── Public exports ────────────────────────────────────────────────────────────

export async function createChart(input: CreateChartInput): Promise<VisualizationResult> {
  const buffer = await renderChart(input);
  const chartId = generateChartId();
  const filename = `${chartId}_${input.title.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "")}.png`;
  const driveUrl = await uploadToDrive(buffer, filename);

  pruneCache();
  visualizationCache.set(chartId, { buffer, driveUrl, title: input.title, type: "chart" });

  return { drive_url: driveUrl, chart_id: chartId };
}

export async function createTable(input: CreateTableInput): Promise<VisualizationResult> {
  const buffer = await renderTable(input);
  const chartId = generateChartId();
  const filename = `${chartId}_${input.title.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "")}.png`;
  const driveUrl = await uploadToDrive(buffer, filename);

  pruneCache();
  visualizationCache.set(chartId, { buffer, driveUrl, title: input.title, type: "table" });

  return { drive_url: driveUrl, chart_id: chartId };
}
