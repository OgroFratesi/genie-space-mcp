import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
  ListTasksCommand,
  StopTaskCommand,
} from "@aws-sdk/client-ecs";

const ecsClient = new ECSClient({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const CLUSTER = () => process.env.ECS_CLUSTER!;

// ── 1. Trigger ────────────────────────────────────────────────────────────────

export interface ScrapeTask {
  league: string;
  season: string;
}

export interface ScrapeResult {
  league: string;
  season: string;
  taskArn: string | null;
  taskId: string | null;
  status: "LAUNCHED" | "FAILED";
  failures?: any[];
}

export async function triggerScrape(
  tasks: ScrapeTask[],
  extraEnv?: Record<string, string>
): Promise<ScrapeResult[]> {
  const sharedEnv = Object.entries(extraEnv ?? {}).map(([name, value]) => ({ name, value }));
  const subnets = process.env.ECS_SUBNETS!.split(",");
  const securityGroups = process.env.ECS_SECURITY_GROUPS?.split(",");

  const vpcConfig: any = { subnets, assignPublicIp: "ENABLED" };
  if (securityGroups?.length) vpcConfig.securityGroups = securityGroups;

  const results: ScrapeResult[] = [];

  for (const task of tasks) {
    const env = [
      { name: "LEAGUE", value: task.league },
      { name: "SEASON", value: task.season },
      ...sharedEnv,
    ];

    const response = await ecsClient.send(
      new RunTaskCommand({
        cluster: CLUSTER(),
        taskDefinition: process.env.ECS_TASK_DEFINITION!,
        launchType: "FARGATE",
        networkConfiguration: { awsvpcConfiguration: vpcConfig },
        overrides: {
          containerOverrides: [
            { name: process.env.ECS_CONTAINER_NAME!, environment: env },
          ],
        },
      })
    );

    if (response.tasks?.length) {
      const arn = response.tasks[0].taskArn ?? null;
      results.push({
        league: task.league,
        season: task.season,
        taskArn: arn,
        taskId: arn?.split("/").pop() ?? null,
        status: "LAUNCHED",
      });
    } else {
      results.push({
        league: task.league,
        season: task.season,
        taskArn: null,
        taskId: null,
        status: "FAILED",
        failures: response.failures,
      });
    }
  }

  return results;
}

// ── 2. Monitor ────────────────────────────────────────────────────────────────

export interface TaskStatus {
  taskId: string;
  league: string;
  season: string;
  status: string;
}

export async function monitorScrape(taskArns: string[]): Promise<TaskStatus[]> {
  const response = await ecsClient.send(
    new DescribeTasksCommand({ cluster: CLUSTER(), tasks: taskArns })
  );

  return (response.tasks ?? []).map((t) => {
    const env: Record<string, string> = {};
    for (const e of t.overrides?.containerOverrides?.[0]?.environment ?? []) {
      if (e.name) env[e.name] = e.value ?? "";
    }
    return {
      taskId: t.taskArn?.split("/").pop() ?? "?",
      league: env["LEAGUE"] ?? "?",
      season: env["SEASON"] ?? "?",
      status: t.lastStatus ?? "?",
    };
  });
}

// ── 3. Stop ───────────────────────────────────────────────────────────────────

export async function stopScrapeTasks(reason = "Manual stop via Claude"): Promise<string[]> {
  const listed = await ecsClient.send(
    new ListTasksCommand({ cluster: CLUSTER(), desiredStatus: "RUNNING" })
  );

  const arns = listed.taskArns ?? [];
  for (const arn of arns) {
    await ecsClient.send(new StopTaskCommand({ cluster: CLUSTER(), task: arn, reason }));
  }

  return arns.map((a) => a.split("/").pop() ?? a);
}
