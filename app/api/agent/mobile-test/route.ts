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
  run: async ({ code, framework, language }) => {
    return JSON.stringify({
      type: "unit_tests",
      framework,
      language,
      instruction:
        "Claude will generate complete unit tests for the provided code using the specified framework.",
      source_length: code.length,
    });
  },
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
  run: async ({ feature_description, modules_involved, framework }) => {
    return JSON.stringify({
      type: "integration_tests",
      framework,
      feature: feature_description,
      modules: modules_involved,
      instruction:
        "Claude will generate integration tests covering the interactions between the listed modules.",
    });
  },
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
  run: async ({ user_journey, framework, platform }) => {
    return JSON.stringify({
      type: "e2e_tests",
      framework,
      platform,
      journey: user_journey,
      instruction:
        "Claude will generate E2E test scripts for the specified user journey.",
    });
  },
});

const generateMockDataTool = betaZodTool({
  name: "generate_mock_data",
  description:
    "Generate realistic mock data and fixtures for mobile-app testing, " +
    "including API responses, database seeds, and factory helpers.",
  inputSchema: z.object({
    data_model: z
      .string()
      .describe(
        "TypeScript interface, JSON schema, or plain description of the data model"
      ),
    count: z.number().min(1).max(100).describe("Number of mock records to generate"),
    format: z
      .enum(["json", "typescript", "dart"])
      .describe("Output format for the mock data"),
  }),
  run: async ({ data_model, count, format }) => {
    return JSON.stringify({
      type: "mock_data",
      format,
      count,
      model_preview: data_model.slice(0, 200),
      instruction:
        "Claude will generate realistic mock data matching the provided data model.",
    });
  },
});

const analyzeCoverageTool = betaZodTool({
  name: "analyze_coverage",
  description:
    "Analyze a mobile-app codebase or component and identify untested areas, " +
    "edge cases, and high-risk paths that should be covered by tests.",
  inputSchema: z.object({
    code_or_description: z
      .string()
      .describe(
        "Source code snippet or plain-text description of the feature/module"
      ),
    existing_tests: z
      .string()
      .optional()
      .describe("Existing test code (if any) to evaluate current coverage"),
  }),
  run: async ({ code_or_description, existing_tests }) => {
    return JSON.stringify({
      type: "coverage_analysis",
      has_existing_tests: !!existing_tests,
      source_length: code_or_description.length,
      instruction:
        "Claude will identify gaps in test coverage and recommend areas to focus on.",
    });
  },
});

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
// Route handler
// ──────────────────────────────────────────

export async function POST(request: Request) {
  let body: { message?: string; history?: Anthropic.MessageParam[] };

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message, history = [] } = body;

  if (!message) {
    return new Response(JSON.stringify({ error: "`message` is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = new Anthropic();

  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: message },
  ];

  const tools = [
    generateUnitTestsTool,
    generateIntegrationTestsTool,
    generateE2eTestsTool,
    generateMockDataTool,
    analyzeCoverageTool,
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Use the streaming tool runner so tool calls are handled automatically
        // and text deltas are forwarded to the client in real time.
        const runner = client.beta.messages.toolRunner({
          model: "claude-opus-4-6",
          max_tokens: 8192,
          thinking: { type: "adaptive" } as { type: "adaptive" },
          system: SYSTEM_PROMPT,
          tools,
          messages,
          stream: true,
        });

        const toolsUsed: Array<{ name: string; input: unknown }> = [];
        let lastUsage: Anthropic.Usage | undefined;
        let lastStopReason: string | undefined;

        // Outer loop: one iteration per tool-runner turn (initial + each tool call)
        for await (const messageStream of runner) {
          // Inner loop: SSE events for this turn
          for await (const event of messageStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              const data = JSON.stringify({
                type: "text",
                delta: event.delta.text,
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }

            if (event.type === "message_delta") {
              lastStopReason = event.delta.stop_reason ?? undefined;
              if (event.usage) lastUsage = event.usage as unknown as Anthropic.Usage;
            }

            // Collect tool-use blocks from message_start to surface them later
            if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
              toolsUsed.push({
                name: event.content_block.name,
                input: event.content_block.input,
              });
            }
          }
        }

        // Send tool-use summary so the client knows which tools were invoked
        if (toolsUsed.length > 0) {
          const toolSummary = JSON.stringify({ type: "tools_used", tools: toolsUsed });
          controller.enqueue(encoder.encode(`data: ${toolSummary}\n\n`));
        }

        // Send usage stats
        const done = JSON.stringify({
          type: "done",
          usage: lastUsage,
          stop_reason: lastStopReason,
        });
        controller.enqueue(encoder.encode(`data: ${done}\n\n`));
      } catch (err) {
        const errData = JSON.stringify({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
        controller.enqueue(encoder.encode(`data: ${errData}\n\n`));
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
