import assert from "node:assert/strict";
import test from "node:test";
import {
  findAskWorthyMissingTailorResumeQuestionTerms,
  isDebugForceConversationInTailorPipelineEnabled,
  latestUserMessageDirectlyConfirmsTechnologyExperience,
  normalizeTailorResumeInterviewResponseForCurrentTurn,
  parseTailorResumeInterviewResponseFromModelOutput,
} from "../lib/tailor-resume-questioning.ts";

test("isDebugForceConversationInTailorPipelineEnabled reads common true values", () => {
  const previousValue =
    process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE;

  process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE = "yes";

  try {
    assert.equal(isDebugForceConversationInTailorPipelineEnabled(), true);
  } finally {
    if (previousValue === undefined) {
      delete process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE;
    } else {
      process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE = previousValue;
    }
  }
});

test("isDebugForceConversationInTailorPipelineEnabled defaults off", () => {
  const previousValue =
    process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE;

  delete process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE;

  try {
    assert.equal(isDebugForceConversationInTailorPipelineEnabled(), false);
  } finally {
    if (previousValue === undefined) {
      delete process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE;
    } else {
      process.env.DEBUG_FORCE_CONVERSATION_IN_TAILOR_PIPELINE = previousValue;
    }
  }
});

test("findAskWorthyMissingTailorResumeQuestionTerms keeps concrete stack gaps", () => {
  assert.deepEqual(
    findAskWorthyMissingTailorResumeQuestionTerms({
      highPriorityMissingFromOriginalResumeAndUserMarkdown: [
        "Palantir Gotham",
        "Go",
        "Cassandra",
        "Spark",
        "Elasticsearch",
        "Gradle",
        "Redux",
      ],
      lowPriorityMissingFromOriginalResumeAndUserMarkdown: ["Kafka"],
      terms: [
        {
          evidence: "Palantir product",
          name: "Palantir Gotham",
          presentInOriginalResume: false,
          presentInUserMarkdown: false,
          priority: "high",
        },
        {
          evidence: "backend services",
          name: "Go",
          presentInOriginalResume: false,
          presentInUserMarkdown: false,
          priority: "high",
        },
        {
          evidence: "data systems",
          name: "Cassandra",
          presentInOriginalResume: false,
          presentInUserMarkdown: false,
          priority: "high",
        },
        {
          evidence: "data systems",
          name: "Spark",
          presentInOriginalResume: false,
          presentInUserMarkdown: false,
          priority: "high",
        },
        {
          evidence: "search",
          name: "Elasticsearch",
          presentInOriginalResume: false,
          presentInUserMarkdown: false,
          priority: "high",
        },
        {
          evidence: "build tooling",
          name: "Gradle",
          presentInOriginalResume: false,
          presentInUserMarkdown: false,
          priority: "high",
        },
        {
          evidence: "frontend state",
          name: "Redux",
          presentInOriginalResume: false,
          presentInUserMarkdown: false,
          priority: "high",
        },
        {
          evidence: "nice-to-have streaming stack",
          name: "Kafka",
          presentInOriginalResume: false,
          presentInUserMarkdown: false,
          priority: "low",
        },
        {
          evidence: "already covered",
          name: "React",
          presentInOriginalResume: true,
          presentInUserMarkdown: false,
          priority: "high",
        },
      ],
    }),
    ["Go", "Cassandra", "Spark", "Elasticsearch", "Gradle", "Redux", "Kafka"],
  );
});

test("normalizeTailorResumeInterviewResponseForCurrentTurn does not treat post-start skip as done", () => {
  const response = normalizeTailorResumeInterviewResponseForCurrentTurn({
    previousSummary: {
      agenda: "deployment details",
      askedQuestionCount: 1,
      debugDecision: null,
      learnings: [],
    },
    response: {
      action: "skip",
      assistantMessage: "",
      completionMessage: "",
      debugDecision: "not_applicable",
      keywordDecisions: [],
      learnings: [],
      userMarkdownEditOperations: [],
    },
  });

  assert.equal(response.action, "skip");
});

test("parseTailorResumeInterviewResponseFromModelOutput reads finish tool calls", () => {
  const response = parseTailorResumeInterviewResponseFromModelOutput({
    output: [
      {
        arguments: JSON.stringify({
          keywordDecisions: [],
          learnings: [
            {
              detail: "Owned LLM deployment latency work.",
              targetSegmentIds: ["segment-1"],
              topic: "LLM deployment",
            },
          ],
          userMarkdownEditOperations: [],
        }),
        call_id: "call-1",
        name: "finish_tailor_resume_interview",
        type: "function_call",
      },
    ],
    output_text:
      "I have enough detail to wrap up, and I am updating USER.md with that context.",
  });

  assert.equal(response.response.action, "done");
  assert.equal(response.response.assistantMessage, "");
  assert.equal(
    response.response.completionMessage,
    "I have enough detail to wrap up, and I am updating USER.md with that context.",
  );
  assert.equal(response.response.debugDecision, "not_applicable");
  assert.equal(
    response.response.learnings[0]?.targetSegmentIds[0],
    "segment-1",
  );
  assert.equal(response.toolCalls[0]?.name, "finish_tailor_resume_interview");
});

test("parseTailorResumeInterviewResponseFromModelOutput preserves cumulative USER.md edits on finish", () => {
  const response = parseTailorResumeInterviewResponseFromModelOutput({
    output: [
      {
        arguments: JSON.stringify({
          keywordDecisions: [],
          learnings: [
            {
              detail: "Confirmed Go, Cassandra, and Spark work at Johns Hopkins.",
              targetSegmentIds: [],
              topic: "Johns Hopkins backend and data infra",
            },
          ],
          userMarkdownEditOperations: [
            {
              headingPath: ["Go"],
              markdown:
                '- "Built Go streaming microservice to ingest disaster-response sensor data at 1k msg/sec with <250ms end-to-end latency for near-real-time dashboards." -- Johns Hopkins\n',
              op: "append",
            },
            {
              headingPath: ["Cassandra"],
              markdown:
                '- "Migrated time-series data from MongoDB to Cassandra to reduce storage costs 40% and improve query tail latency by 2x." -- Johns Hopkins\n',
              op: "append",
            },
            {
              headingPath: ["Spark"],
              markdown:
                '- "Wrote Spark streaming pipeline to aggregate event streams for real-time metrics at 10k msg/sec with exactly-once semantics." -- Johns Hopkins\n',
              op: "append",
            },
          ],
        }),
        call_id: "call-finish-cumulative",
        name: "finish_tailor_resume_interview",
        type: "function_call",
      },
    ],
    output_text:
      "I have enough detail to wrap up, and I am updating USER.md with the Go, Cassandra, and Spark context from this chat.",
  });

  assert.equal(response.response.action, "done");
  assert.equal(response.response.userMarkdownEditOperations.length, 3);
  assert.deepEqual(
    response.response.userMarkdownEditOperations.map((operation) =>
      operation.headingPath.join(" / "),
    ),
    ["Go", "Cassandra", "Spark"],
  );
});

test("parseTailorResumeInterviewResponseFromModelOutput reads non-technology update tool calls", () => {
  const response = parseTailorResumeInterviewResponseFromModelOutput({
    output: [
      {
        arguments: JSON.stringify({
          completionMessage:
            "I added Chromium and Internationalization to the non-technology list and removed them from this run. Press Done when you're ready.",
          keywordDecisions: [
            {
              action: "remove",
              name: "Chromium",
              reason: "The user said these are not real skills.",
            },
            {
              action: "remove",
              name: "internationalization",
              reason: "The user said these are not real skills.",
            },
          ],
          learnings: [],
          nonTechnologyTerms: ["Chromium", "internationalization"],
          userMarkdownEditOperations: [],
        }),
        call_id: "call-non-tech",
        name: "update_tailor_resume_non_technologies",
        type: "function_call",
      },
    ],
    output_text:
      "I added Chromium and Internationalization to the non-technology list and removed them from this run. Press Done when you're ready.",
  });

  assert.equal(response.response.action, "done");
  assert.deepEqual(response.response.nonTechnologyTerms, [
    "chromium",
    "internationalization",
  ]);
  assert.equal(
    response.toolCalls[0]?.name,
    "update_tailor_resume_non_technologies",
  );
});

test("parseTailorResumeInterviewResponseFromModelOutput reads probing-question tool calls with assistant text", () => {
  const response = parseTailorResumeInterviewResponseFromModelOutput({
    output: [
      {
        arguments: JSON.stringify({
          debugDecision: "not_applicable",
          keywordDecisions: [],
          learnings: [
            {
              detail:
                "Need the model family, serving stack, and one measurable outcome from the Java LLM pipeline work.",
              targetSegmentIds: ["segment-2"],
              topic: "Java LLM pipeline",
            },
          ],
          userMarkdownEditOperations: [],
        }),
        call_id: "call-2",
        name: "initiate_tailor_resume_probing_questions",
        type: "function_call",
      },
    ],
    output_text:
      "For a Java backend angle, strong answers would sound like 'I owned the Spring Boot API layer around the LLM pipeline' or 'I built the Java service flow for prompt orchestration, retrieval, and eval logging.' Which model family, serving stack, and measurable outcome best match your work?",
  });

  assert.equal(response.response.action, "ask");
  assert.match(response.response.assistantMessage, /Spring Boot API layer/i);
  assert.match(
    response.response.assistantMessage,
    /Which model family, serving stack, and measurable outcome/i,
  );
  assert.equal(response.response.debugDecision, "not_applicable");
  assert.equal(response.toolCalls[0]?.name, "initiate_tailor_resume_probing_questions");
});

test("parseTailorResumeInterviewResponseFromModelOutput keeps follow-up technology cards", () => {
  const response = parseTailorResumeInterviewResponseFromModelOutput({
    output: [
      {
        arguments: JSON.stringify({
          assistantMessage:
            "Your answer sounded close to Cassandra work. Which resume project should this map to?",
          debugDecision: "not_applicable",
          keywordDecisions: [],
          learnings: [],
          technologyContexts: [
            {
              definition:
                "Cassandra is a distributed NoSQL database used for high-write, large-scale event or time-series data.",
              examples: [
                "Designed Cassandra data models for high-volume event writes -- NewForm",
                "Migrated time-series metrics into Cassandra-backed storage -- KnoWhiz",
              ],
              name: "cassandra",
            },
          ],
          userMarkdownEditOperations: [],
        }),
        call_id: "call-follow-up",
        name: "initiate_tailor_resume_probing_questions",
        type: "function_call",
      },
    ],
  });

  assert.equal(response.response.action, "ask");
  assert.equal(response.response.technologyContexts.length, 1);
  assert.equal(response.response.technologyContexts[0]?.name, "Cassandra");
  assert.deepEqual(response.response.technologyContexts[0]?.examples, [
    "Designed Cassandra data models for high-volume event writes -- NewForm",
    "Migrated time-series metrics into Cassandra-backed storage -- KnoWhiz",
  ]);
});

test("parseTailorResumeInterviewResponseFromModelOutput allows requested extra technology examples", () => {
  const response = parseTailorResumeInterviewResponseFromModelOutput({
    output: [
      {
        arguments: JSON.stringify({
          assistantMessage:
            "Here are four more realistic Go options. Which ones are closest to your experience?",
          debugDecision: "not_applicable",
          keywordDecisions: [],
          learnings: [],
          technologyContexts: [
            {
              definition:
                "Go is a compiled language commonly used for backend services, workers, APIs, and infrastructure tooling.",
              examples: [
                "Rewrote Quizlet import worker in Go, increasing throughput 3x and cutting memory usage 50% -- KnoWhiz",
                "Implemented Go concurrent worker pool and AWS SQS consumers to process onboarding jobs at 200 jobs/sec, reducing backlog 75% -- HF Engineering",
                "Built Go streaming service to ingest sensor data at 1k msg/sec with sub-250ms latency for near-real-time dashboards -- Johns Hopkins University",
                "Replaced Java PDF parsing pipeline with a Go service to cut page generation from minutes to under 15s and reduce hosting costs 30% -- Chief of NYC Fire Dept Website",
              ],
              name: "Go",
            },
          ],
          userMarkdownEditOperations: [],
        }),
        call_id: "call-more-examples",
        name: "initiate_tailor_resume_probing_questions",
        type: "function_call",
      },
    ],
  });

  assert.equal(response.response.action, "ask");
  assert.equal(response.response.technologyContexts[0]?.name, "Go");
  assert.equal(response.response.technologyContexts[0]?.examples.length, 4);
  assert.match(
    response.response.assistantMessage,
    /Which ones are closest to your experience/i,
  );
});

test("parseTailorResumeInterviewResponseFromModelOutput rejects duplicated technology card text", () => {
  assert.throws(
    () =>
      parseTailorResumeInterviewResponseFromModelOutput({
        output: [
          {
            arguments: JSON.stringify({
              assistantMessage:
                "Two Go bullet suggestions you can use outside NewForm:\n\n- Built a Go microservice for Quizlet imports, replacing a Python ETL and increasing throughput 4x while cutting memory use 60% -- KnoWhiz\n- Implemented a Go-based concurrent worker pool and AWS SQS consumers to process onboarding jobs at 2k jobs/sec, reducing processing lag 80% -- HF Engineering\n\nWhich of these should I add?",
              debugDecision: "not_applicable",
              keywordDecisions: [],
              learnings: [],
              technologyContexts: [
                {
                  definition:
                    "Go is a compiled language designed for building high-performance backend services and concurrent systems.",
                  examples: [
                    "Built a Go microservice for Quizlet imports, replacing a Python ETL and increasing throughput 4x while cutting memory use 60% -- KnoWhiz",
                    "Implemented a Go-based concurrent worker pool and AWS SQS consumers to process onboarding jobs at 2k jobs/sec, reducing processing lag 80% -- HF Engineering",
                  ],
                  name: "Go",
                },
              ],
              userMarkdownEditOperations: [],
            }),
            call_id: "call-duplicate-card",
            name: "initiate_tailor_resume_probing_questions",
            type: "function_call",
          },
        ],
      }),
    /must not repeat the rendered definition or example bullets/i,
  );
});

test("parseTailorResumeInterviewResponseFromModelOutput rejects plain JSON text", () => {
  assert.throws(
    () =>
      parseTailorResumeInterviewResponseFromModelOutput({
        output_text: JSON.stringify({
          action: "done",
          debugDecision: "not_applicable",
          learnings: [],
        }),
      }),
    /tool call/i,
  );
});

test("latestUserMessageDirectlyConfirmsTechnologyExperience detects concise technology confirmations", () => {
  assert.equal(
    latestUserMessageDirectlyConfirmsTechnologyExperience({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "Do you have experience with Go, Cassandra, or Spark?",
          toolCalls: [],
        },
        {
          id: "user-1",
          role: "user",
          text: "Yes: I have used Go, Cassandra, Spark, Elasticsearch, Redux, and Gradle.",
          toolCalls: [],
        },
      ],
      technologyNames: ["Go", "Cassandra", "Spark"],
    }),
    true,
  );
});

test("latestUserMessageDirectlyConfirmsTechnologyExperience ignores user requests for examples", () => {
  assert.equal(
    latestUserMessageDirectlyConfirmsTechnologyExperience({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "Do you have experience with Go?",
          toolCalls: [],
        },
        {
          id: "user-1",
          role: "user",
          text: "Yes, I have used Go. Can you show me a concise bullet?",
          toolCalls: [],
        },
      ],
      technologyNames: ["Go"],
    }),
    false,
  );
});
