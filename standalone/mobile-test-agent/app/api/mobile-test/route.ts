import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ──────────────────────────────────────────
// Tool definitions
// ──────────────────────────────────────────

const generateUnitTestsTool = betaZodTool({
  name: "generate_unit_tests",
  description:
    "Generate unit / component tests for a given piece of mobile-app code. " +
    "Supports React Native, Flutter, Swift, Kotlin, and plain TypeScript/JavaScript.",
  inputSchema: z.object({
    code: z.string().describe("Source code of the component or function to test"),
    framework: z
      .enum(["jest", "vitest", "xctest", "junit", "flutter_test"])
      .describe("Target test framework"),
    language: z
      .enum(["typescript", "javascript", "swift", "kotlin", "dart"])
      .describe("Programming language of the source code"),
  }),
  run: async ({ code, framework, language }) =>
    JSON.stringify({ type: "unit_tests", framework, language, source_length: code.length }),
});

const generateIntegrationTestsTool = betaZodTool({
  name: "generate_integration_tests",
  description:
    "Generate integration tests that verify how multiple mobile-app modules interact, " +
    "including API calls, navigation flows, and state management.",
  inputSchema: z.object({
    feature_description: z
      .string()
      .describe("High-level description of the feature or user flow to test"),
    modules_involved: z
      .array(z.string())
      .describe("Names of the modules / screens / services involved"),
    framework: z
      .enum(["jest", "vitest", "xctest", "junit", "flutter_test"])
      .describe("Target test framework"),
  }),
  run: async ({ feature_description, modules_involved, framework }) =>
    JSON.stringify({ type: "integration_tests", framework, feature: feature_description, modules: modules_involved }),
});

const generateE2eTestsTool = betaZodTool({
  name: "generate_e2e_tests",
  description:
    "Generate end-to-end (E2E) tests for mobile apps using Detox (React Native) or Maestro. " +
    "Covers full user journeys from app launch to task completion.",
  inputSchema: z.object({
    user_journey: z
      .string()
      .describe("Step-by-step description of the user journey to automate"),
    framework: z
      .enum(["detox", "maestro", "espresso", "xcuitest"])
      .describe("E2E test framework to use"),
    platform: z.enum(["ios", "android", "both"]).describe("Target platform(s)"),
  }),
  run: async ({ user_journey, framework, platform }) =>
    JSON.stringify({ type: "e2e_tests", framework, platform, journey: user_journey }),
});

const generateMockDataTool = betaZodTool({
  name: "generate_mock_data",
  description:
    "Generate realistic mock data and fixtures for mobile-app testing, " +
    "including API responses, database seeds, and factory helpers.",
  inputSchema: z.object({
    data_model: z
      .string()
      .describe("TypeScript interface, JSON schema, or plain description of the data model"),
    count: z.number().min(1).max(100).describe("Number of mock records to generate"),
    format: z.enum(["json", "typescript", "dart"]).describe("Output format for the mock data"),
  }),
  run: async ({ data_model, count, format }) =>
    JSON.stringify({ type: "mock_data", format, count, model_preview: data_model.slice(0, 200) }),
});

const analyzeCoverageTool = betaZodTool({
  name: "analyze_coverage",
  description:
    "Analyze a mobile-app codebase or component and identify untested areas, " +
    "edge cases, and high-risk paths that should be covered by tests.",
  inputSchema: z.object({
    code_or_description: z
      .string()
      .describe("Source code snippet or plain-text description of the feature/module"),
    existing_tests: z
      .string()
      .optional()
      .describe("Existing test code (if any) to evaluate current coverage"),
  }),
  run: async ({ code_or_description, existing_tests }) =>
    JSON.stringify({
      type: "coverage_analysis",
      has_existing_tests: !!existing_tests,
      source_length: code_or_description.length,
    }),
});

const TOOLS = [
  generateUnitTestsTool,
  generateIntegrationTestsTool,
  generateE2eTestsTool,
  generateMockDataTool,
  analyzeCoverageTool,
];

// ──────────────────────────────────────────
// System prompt
// ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are a world-class mobile-app QA engineer and test automation expert.
Your sole purpose is to help developers write, review, and improve tests for mobile applications.

You specialize in:
- React Native (Jest + React Native Testing Library + Detox)
- Flutter (flutter_test + integration_test)
- iOS native (XCTest / XCUITest)
- Android native (JUnit + Espresso)

When helping with tests you:
1. Always use the available tools to produce structured test artefacts.
2. Follow best practices: Arrange-Act-Assert, meaningful test names, isolated tests.
3. Cover happy paths, edge cases, error states, and accessibility.
4. Generate realistic mock data that matches production shapes.
5. Provide brief explanations of WHY each test case matters.
6. Prefer async/await patterns and proper teardown.

If the user's request is ambiguous, ask one clarifying question before proceeding.
Respond in the same language the user writes in (Japanese or English).`;

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

interface RequestBody {
  message?: string;
  history?: Anthropic.MessageParam[];
}

// ──────────────────────────────────────────
// Route handler
// ──────────────────────────────────────────

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { message, history = [] } = body;
  if (!message) {
    return Response.json({ error: "`message` is required" }, { status: 400 });
  }

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: message },
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (obj: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        const runner = client.beta.messages.toolRunner({
          model: "claude-opus-4-6",
          max_tokens: 8192,
          thinking: { type: "adaptive" } as { type: "adaptive" },
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
          stream: true,
        });

        const toolsUsed: Array<{ name: string; input: unknown }> = [];
        let lastUsage: Anthropic.Usage | undefined;
        let lastStopReason: string | undefined;

        for await (const messageStream of runner) {
          for await (const event of messageStream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              enqueue({ type: "text", delta: event.delta.text });
            }
            if (event.type === "message_delta") {
              lastStopReason = event.delta.stop_reason ?? undefined;
              if (event.usage) lastUsage = event.usage as unknown as Anthropic.Usage;
            }
            if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
              toolsUsed.push({ name: event.content_block.name, input: event.content_block.input });
            }
          }
        }

        if (toolsUsed.length > 0) enqueue({ type: "tools_used", tools: toolsUsed });
        enqueue({ type: "done", usage: lastUsage, stop_reason: lastStopReason });
      } catch (err) {
        enqueue({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
