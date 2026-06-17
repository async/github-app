import { definePipeline, env, job, sh, task, trigger } from "@async/pipeline";

export default definePipeline({
  name: "github-app",
  cache: "file:local",
  triggers: {
    pr: trigger.github({ events: ["pull_request"] }),
    main: trigger.github({ events: ["push"], branches: ["main"] }),
    release: trigger.github({ events: ["release"] }),
    manual: trigger.manual()
  },
  sync: {
    github: {
      nodeVersion: 24,
      cache: true
    },
    tasks: {
      prefix: "pipeline",
      runners: ["package"],
      targets: [{ package: "@async/github-app" }],
      jobs: ["preview", "publish", "release-doctor", "snapshot", "verify"],
      scripts: {
        "github:check": "github check",
        "github:generate": "github generate",
        "publish:github:main": "publish github main --package .",
        "publish:github:pr": "publish github pr --package .",
        "publish:github:release": "publish github release --package .",
        "publish:npm": "publish npm --package .",
        "release:doctor": "release doctor --package .",
        "release:ensure": "release ensure --package .",
        "sync:check": "sync check",
        "sync:generate": "sync generate",
        "verify:force": "run verify --force"
      }
    }
  },
  namedInputs: {
    source: [
      "src/**/*.ts",
      "tests/**/*.test.js",
      "README.md",
      "CHANGELOG.md",
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig.json"
    ],
    pipeline: [
      "pipeline.ts",
      ".github/workflows/async-pipeline.yml",
      ".github/async-pipeline.lock.json",
      ".async-pipeline/tasks.lock.json"
    ],
    "api-surface": [
      "api-contract.json",
      "API_SURFACE.md"
    ],
    production: [
      "src/**/*.ts",
      "README.md",
      "CHANGELOG.md",
      "api-contract.json",
      "API_SURFACE.md",
      "package.json",
      "tsconfig.json"
    ]
  },
  tasks: {
    "sync-check": task({
      description: "Generated workflow, lock, and package scripts still match pipeline.ts.",
      inputs: ["pipeline", "package.json"],
      cache: false,
      run: sh`pnpm async-pipeline sync check`
    }),
    "api-surface-generate": task({
      description: "Regenerate the public API surface ledger from api-contract.json.",
      inputs: ["api-contract.json"],
      outputs: ["API_SURFACE.md"],
      cache: false,
      run: sh`pnpm api-surface:generate`
    }),
    "api-surface": task({
      description: "Validate the public API contract manifest and generated ledger.",
      inputs: ["api-surface"],
      cache: true,
      run: sh`pnpm api-surface:check`
    }),
    build: task({
      inputs: ["production"],
      outputs: ["dist/**"],
      cache: true,
      run: sh`pnpm build`
    }),
    typecheck: task({
      dependsOn: ["build"],
      inputs: ["source"],
      cache: true,
      run: sh`pnpm typecheck`
    }),
    test: task({
      dependsOn: ["typecheck"],
      inputs: ["source"],
      cache: true,
      run: sh`node --test tests/*.test.js`
    }),
    pack: task({
      dependsOn: ["test", "api-surface", "sync-check"],
      inputs: ["production", "pipeline", "api-surface"],
      cache: false,
      run: sh`pnpm pack:check`
    }),
    preview: task({
      description: "Publish same-repo PR previews to GitHub Packages.",
      dependsOn: ["pack"],
      inputs: ["production"],
      cache: false,
      run: sh`pnpm async-pipeline publish github pr --package .`
    }),
    snapshot: task({
      description: "Publish main snapshots to GitHub Packages.",
      dependsOn: ["pack"],
      inputs: ["production"],
      cache: false,
      run: sh`pnpm async-pipeline publish github main --package .`
    }),
    "publish-github": task({
      description: "Publish the stable release mirror to GitHub Packages.",
      dependsOn: ["release-ensure"],
      inputs: ["production"],
      cache: false,
      run: sh`pnpm async-pipeline publish github release --package .`
    }),
    "release-ensure": task({
      description: "Create or verify the release tag and GitHub Release before package publishing.",
      dependsOn: ["pack"],
      inputs: ["production"],
      cache: false,
      run: sh`pnpm async-pipeline release ensure --package .`
    }),
    publish: task({
      dependsOn: ["publish-github"],
      inputs: ["production"],
      cache: false,
      run: [
        sh`pnpm async-pipeline publish npm --package .`,
        sh`pnpm async-pipeline release doctor --package .`
      ]
    }),
    "release-doctor": task({
      description: "Verify the stable version after publication.",
      inputs: ["production"],
      cache: false,
      run: sh`pnpm async-pipeline release doctor --package .`
    })
  },
  jobs: {
    verify: job({
      target: "pack",
      trigger: ["pr", "main", "release"]
    }),
    preview: job({
      target: "preview",
      trigger: ["pr"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          issues: "write",
          packages: "write",
          pullRequests: "write"
        }
      }
    }),
    snapshot: job({
      target: "snapshot",
      trigger: ["main"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "write",
          packages: "write"
        }
      }
    }),
    publish: job({
      target: "publish",
      trigger: ["manual", "release"],
      environment: {
        name: "npm-publish",
        url: "https://www.npmjs.com/package/@async/github-app"
      },
      requires: {
        provenance: true
      },
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN"),
        NODE_AUTH_TOKEN: env.secret("NPM_TOKEN")
      },
      github: {
        permissions: {
          contents: "write",
          packages: "write"
        }
      }
    }),
    "release-doctor": job({
      target: "release-doctor",
      trigger: ["manual"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "read",
          packages: "read"
        }
      }
    })
  }
});
