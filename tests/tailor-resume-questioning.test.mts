import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTailorResumeExperiencePlacementNames,
  findAskWorthyMissingTailorResumeQuestionTerms,
  isDebugForceConversationInTailorPipelineEnabled,
  latestUserMessageDirectlyConfirmsTechnologyExperience,
  normalizeTailorResumeInterviewResponseForCurrentTurn,
  parseTailorResumeInterviewResponseFromModelOutput,
  tailorResumeAskMessageRequestsUserMarkdownPermission,
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

test("extractTailorResumeExperiencePlacementNames reads resume employers and internships", () => {
  assert.deepEqual(
    extractTailorResumeExperiencePlacementNames(
      [
        "WORK EXPERIENCE",
        "NewForm AI | Software Engineer I --- Full Time Aug 2025 - Feb 2026",
        "KnoWhiz | Software Engineering Intern May 2024 - Sep 2024",
        "HF Engineering | Software Engineering Intern May 2024 - Sep 2024",
        "Johns Hopkins University | Software Development Intern May 2023 - Aug 2023",
        "EDUCATION",
        "Johns Hopkins University | Bachelor of Science",
      ].join("\n"),
    ),
    ["NewForm AI", "KnoWhiz", "HF Engineering", "Johns Hopkins University"],
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

test("normalizeTailorResumeInterviewResponseForCurrentTurn finishes timid memory-confirmation asks", () => {
  const response = normalizeTailorResumeInterviewResponseForCurrentTurn({
    conversation: [
      {
        id: "assistant-1",
        role: "assistant",
        text: "Do any of these match your experience?",
        toolCalls: [],
      },
      {
        id: "user-1",
        role: "user",
        text:
          "Yes, I used Grafana and Cilium at Johns Hopkins. Please end the chat and tailor it.",
        toolCalls: [],
      },
    ],
    emphasizedTechnologyNames: ["Grafana", "Cilium"],
    previousSummary: {
      agenda: "technology details",
      askedQuestionCount: 1,
      debugDecision: null,
      learnings: [],
    },
    response: {
      action: "ask",
      assistantMessage:
        "Do you want me to update USER.md with the confirmed Grafana and Cilium experience?",
      completionMessage: "",
      debugDecision: "not_applicable",
      keywordDecisions: [],
      learnings: [],
      nonTechnologyTerms: [],
      technologyContexts: [
        {
          definition: "Grafana is an observability dashboarding tool.",
          examples: [
            "Built Grafana dashboards that cut alert triage time 35%.",
            "Integrated Grafana alerts to reduce noisy pages 40%.",
          ],
          name: "Grafana",
        },
      ],
      userMarkdownEditOperations: [
        {
          anchorMarkdown: "",
          headingPath: ["Grafana"],
          markdown:
            '- "Built Grafana dashboards that cut alert triage time 35%." -- Johns Hopkins\n',
          newMarkdown: "",
          oldMarkdown: "",
          op: "append",
        },
      ],
    },
  });

  assert.equal(response.action, "done");
  assert.equal(response.assistantMessage, "");
  assert.match(response.completionMessage, /update USER\.md/i);
  assert.deepEqual(response.technologyContexts, []);
});

test("normalizeTailorResumeInterviewResponseForCurrentTurn finishes placement-confirmation asks", () => {
  const response = normalizeTailorResumeInterviewResponseForCurrentTurn({
    conversation: [
      {
        id: "assistant-1",
        role: "assistant",
        text: "Which generated example bullets match your actual experience?",
        toolCalls: [],
      },
      {
        id: "user-1",
        role: "user",
        text:
          'Grafana: Use "Integrated Grafana with Prometheus to create service-level dashboards and automated alerts, cutting P1 pages by 40%" in Johns Hopkins University internship.\n\nCilium: Use "Deployed Cilium CNI to secure east-west traffic across 50-node Kubernetes cluster, reducing policy complexity by 60%" for N-body Orbits project. And add that under Kubernetes too.\n\nEnvoy: Use "Integrated Envoy with Istio and Prometheus to enable distributed tracing and metrics, improving visibility into inter-service latency and production failure debugging across microservices." for Johns Hopkins University.\n\nYou can add Windsurf and Cline in skills section but don\'t include it in a work experience.',
        toolCalls: [],
      },
    ],
    emphasizedTechnologyNames: ["Grafana", "Cilium", "Envoy", "Windsurf", "Cline"],
    previousSummary: {
      agenda: "technology details",
      askedQuestionCount: 1,
      debugDecision: null,
      learnings: [],
    },
    response: {
      action: "ask",
      assistantMessage:
        "Should I add the confirmed Grafana, Cilium, and Envoy bullets to your Johns Hopkins, N-body, and Johns Hopkins entries and list Windsurf/Cline in skills?",
      completionMessage: "",
      debugDecision: "not_applicable",
      keywordDecisions: [],
      learnings: [],
      nonTechnologyTerms: [],
      technologyContexts: [],
      userMarkdownEditOperations: [
        {
          anchorMarkdown: "",
          headingPath: ["Grafana"],
          markdown:
            '- "Integrated Grafana with Prometheus to create service-level dashboards and automated alerts, cutting P1 pages by 40%" -- Johns Hopkins University\n',
          newMarkdown: "",
          oldMarkdown: "",
          op: "append",
        },
      ],
    },
  });

  assert.equal(response.action, "done");
  assert.equal(response.assistantMessage, "");
  assert.match(response.completionMessage, /confirmed Grafana/i);
});

test("detects ask messages that only request USER.md update permission", () => {
  assert.equal(
    tailorResumeAskMessageRequestsUserMarkdownPermission(
      "Thanks — I can proceed to implement the tailored LaTeX resume now using your confirmed technology notes. Before I start, do you want me to add Grafana, Cilium, Envoy as quoted experience bullets and add Windsurf & Cline to the skills section only?",
    ),
    true,
  );
  assert.equal(
    tailorResumeAskMessageRequestsUserMarkdownPermission(
      "Which service did the Go work belong to?",
    ),
    false,
  );
});

test("normalizeTailorResumeInterviewResponseForCurrentTurn keeps permission asks without USER.md edits visible", () => {
  const response = normalizeTailorResumeInterviewResponseForCurrentTurn({
    conversation: [
      {
        id: "assistant-1",
        role: "assistant",
        text: "Which generated example bullets match your actual experience?",
        toolCalls: [],
      },
      {
        id: "user-1",
        role: "user",
        text:
          'Cilium: Use "Deployed Cilium CNI to secure east-west traffic across 50-node Kubernetes cluster, reducing policy complexity by 60%" for N-body Orbits project. And add that under Kubernetes too.',
        toolCalls: [],
      },
    ],
    emphasizedTechnologyNames: ["Cilium", "Kubernetes"],
    previousSummary: {
      agenda: "technology details",
      askedQuestionCount: 1,
      debugDecision: null,
      learnings: [],
    },
    response: {
      action: "ask",
      assistantMessage:
        "Before I start, do you want me to add Cilium as a quoted experience bullet and add that under Kubernetes too?",
      completionMessage: "",
      debugDecision: "not_applicable",
      keywordDecisions: [],
      learnings: [],
      nonTechnologyTerms: [],
      technologyContexts: [],
      userMarkdownEditOperations: [],
    },
  });

  assert.equal(response.action, "ask");
  assert.match(response.assistantMessage, /do you want me to add Cilium/i);
});

test("normalizeTailorResumeInterviewResponseForCurrentTurn strips ordinary follow-up cards", () => {
  const response = normalizeTailorResumeInterviewResponseForCurrentTurn({
    conversation: [
      {
        id: "assistant-1",
        role: "assistant",
        text: "Do you have Go experience?",
        toolCalls: [],
      },
      {
        id: "user-1",
        role: "user",
        text: "I used Go for backend services at Johns Hopkins.",
        toolCalls: [],
      },
    ],
    emphasizedTechnologyNames: ["Go"],
    previousSummary: {
      agenda: "technology details",
      askedQuestionCount: 1,
      debugDecision: null,
      learnings: [],
    },
    response: {
      action: "ask",
      assistantMessage: "Which service did the Go work belong to?",
      completionMessage: "",
      debugDecision: "not_applicable",
      keywordDecisions: [],
      learnings: [],
      nonTechnologyTerms: [],
      technologyContexts: [
        {
          definition: "Go is used for backend services.",
          examples: [
            "Built Go services that reduced latency 25%.",
            "Migrated workers to Go and cut memory 40%.",
          ],
          name: "Go",
        },
      ],
      userMarkdownEditOperations: [],
    },
  });

  assert.equal(response.action, "ask");
  assert.deepEqual(response.technologyContexts, []);
});

test("parseTailorResumeInterviewResponseFromModelOutput reads finish tool calls", () => {
  const response = parseTailorResumeInterviewResponseFromModelOutput({
    output: [
      {
        arguments: JSON.stringify({
          completionMessage:
            "I have enough detail to wrap up, and I am updating USER.md with that context.",
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
    output_text: "A stale normal-text finish message.",
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
            "I added Chromium and Internationalization to the non-technology list and removed them from this run.",
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
          nonTechnologyTerms: ["Chromium", "internationalization"],
        }),
        call_id: "call-non-tech",
        name: "update_tailor_resume_non_technologies",
        type: "function_call",
      },
    ],
    output_text:
      "I added Chromium and Internationalization to the non-technology list and removed them from this run.",
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
          assistantMessage:
            "For a Java backend angle, strong answers would sound like 'I owned the Spring Boot API layer around the LLM pipeline' or 'I built the Java service flow for prompt orchestration, retrieval, and eval logging.' Which model family, serving stack, and measurable outcome best match your work?",
          technologyContexts: [],
        }),
        call_id: "call-2",
        name: "initiate_tailor_resume_probing_questions",
        type: "function_call",
      },
    ],
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

test("parseTailorResumeInterviewResponseFromModelOutput preserves weak example cards", () => {
  const response = parseTailorResumeInterviewResponseFromModelOutput({
    output: [
      {
        arguments: JSON.stringify({
          assistantMessage:
            "Here are a couple of Azure ideas. Which, if any, match your experience?",
          technologyContexts: [
            {
              definition:
                "Azure is a cloud platform used for deploying and operating production services.",
              examples: [
                "Provisioned Azure Kubernetes Service -- Purview Data Platform",
                "Migrated Azure workloads -- Azure App Services",
              ],
              name: "Azure",
            },
          ],
        }),
        call_id: "call-weak-examples",
        name: "initiate_tailor_resume_probing_questions",
        type: "function_call",
      },
    ],
  });

  assert.equal(response.response.action, "ask");
  assert.deepEqual(response.response.technologyContexts[0]?.examples, [
    "Provisioned Azure Kubernetes Service -- Purview Data Platform",
    "Migrated Azure workloads -- Azure App Services",
  ]);
});

test("parseTailorResumeInterviewResponseFromModelOutput allows requested extra technology examples", () => {
  const response = parseTailorResumeInterviewResponseFromModelOutput({
    output: [
      {
        arguments: JSON.stringify({
          assistantMessage:
            "Here are four more realistic Go options. Which ones are closest to your experience?",
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

test("parseTailorResumeInterviewResponseFromModelOutput preserves duplicated technology card text", () => {
  const response = parseTailorResumeInterviewResponseFromModelOutput({
    output: [
      {
        arguments: JSON.stringify({
          assistantMessage:
            "Two Go bullet suggestions you can use outside NewForm:\n\n- Built a Go microservice for Quizlet imports, replacing a Python ETL and increasing throughput 4x while cutting memory use 60% -- KnoWhiz\n- Implemented a Go-based concurrent worker pool and AWS SQS consumers to process onboarding jobs at 2k jobs/sec, reducing processing lag 80% -- HF Engineering\n\nWhich of these should I add?",
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
        }),
        call_id: "call-duplicate-card",
        name: "initiate_tailor_resume_probing_questions",
        type: "function_call",
      },
    ],
  });

  assert.equal(response.response.action, "ask");
  assert.equal(response.response.technologyContexts[0]?.name, "Go");
  assert.match(response.response.assistantMessage, /Two Go bullet suggestions/i);
});

test("parseTailorResumeInterviewResponseFromModelOutput coerces plain JSON text", () => {
  const response = parseTailorResumeInterviewResponseFromModelOutput({
    output_text: JSON.stringify({
      action: "done",
      debugDecision: "not_applicable",
      learnings: [],
    }),
  });

  assert.equal(response.response.action, "done");
  assert.match(response.response.completionMessage, /enough context/i);
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
