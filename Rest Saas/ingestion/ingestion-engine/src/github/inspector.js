"use strict";

const { Octokit } = require("@octokit/rest");
const { parseEnvKeys } = require("../env-parser");

// Files whose *content* is worth reading to understand the app's shape.
// Broadened beyond JS/TS conventions to Python, Ruby, Go, Java, PHP, .NET.
const HIGH_VALUE_PATTERNS = [
  /route|controller|handler|endpoint|api|urls?\.py|views?\.py/i,
  /model|schema|entity|migration|prisma|sequelize|typeorm|knex|alembic/i,
  /middleware|guard|interceptor|auth|permission|policy|role/i,
  /config|setting|env|\.env\.example|dotenv|application\.ya?ml|application\.properties/i,
  /^(src\/|app\/|cmd\/[^/]+\/)?(index|main|app|server|manage|wsgi|asgi|program)\.(js|ts|py|go|rb|java|cs)$/i,
  /serializer|validator|dto|schema|joi|zod|yup|pydantic/i,
  /service|repository|repo|store|dao|usecase/i,
  /\.test\.|\.spec\.|__tests__|_test\.go|test_.*\.py/i,
  /database|db|connection|pool/i,
  /response|exception|error|factory|factories|component|hook|store|context|\.vue$|\.svelte$|\.tsx$|\.jsx$|tsconfig/i,
  /(^|\/)(types?|interfaces?)\/|\.d\.ts$/i,
  /readme|openapi|swagger|postman/i,
  /package\.json|requirements.*\.txt|pyproject\.toml|go\.mod|gemfile|cargo\.toml|pom\.xml|build\.gradle|composer\.json|.*\.csproj/i,
  /dockerfile|docker-compose|\.github\/workflows/i,
];

// Directories/files that never carry useful architectural signal — vendored
// deps, build output, binaries, IDE/tooling noise, lockfiles.
const SKIP_PATTERNS = [
  /(^|\/)\.env(?:\.[^/]*)?$/i,
  /(^|\/)(credentials[^/]*|secrets?)(\/|\.|$)/i,
  /\.(pem|key|p12|pfx)$/i,
  /node_modules/i, /\.git\//i, /dist\//i, /build\//i, /__pycache__/i,
  /\.next\//i, /\.nuxt\//i, /coverage\//i, /\.cache\//i,
  /(^|\/)(vendor|venv|\.venv|env)\//i, /target\//i, /bin\//i, /obj\//i,
  /(^|\/)(staticfiles|coverage|\.pytest_cache)\//i,
  /\.pytest_cache\//i, /\.mypy_cache\//i, /\.terraform\//i,
  /\.egg-info\//i, /Pods\//i, /DerivedData\//i, /\.idea\//i, /\.vscode\//i,
  /\.(min\.js|map|lock|sum)$/i,
  /\.(png|jpg|jpeg|gif|svg|ico|webp|mp4|mp3|pdf|zip|tar|gz|7z|rar)$/i,
  /\.(woff|woff2|ttf|eot|otf)$/i,
  /\.(exe|dll|so|dylib|class|jar|war|pyc|pyo|o|a|bin)$/i,
  /\.(db|sqlite|sqlite3)$/i,
];

function isHighValue(path) {
  return HIGH_VALUE_PATTERNS.some((p) => p.test(path));
}

function shouldSkip(path) {
  return SKIP_PATTERNS.some((p) => p.test(path));
}

function inferFileRole(path) {
  const lower = path.toLowerCase();
  if (/dockerfile|docker-compose/.test(lower)) return "deployment-config";
  if (/\.github\/workflows/.test(lower)) return "ci-config";
  if (/response|exception|errors?\.|factory|factories|prisma\.config|tsconfig/.test(lower)) return "shared-contract";
  if (/urls?\.py|route|controller|handler/.test(lower)) return "route/controller";
  if (/views?\.py/.test(lower)) return "route/controller";
  if (/wsgi\.py|asgi\.py|manage\.py/.test(lower)) return "entry-point";
  if (/model|entity|schema/.test(lower) && !/migration/.test(lower)) return "data-model";
  if (/migration|alembic/.test(lower)) return "migration";
  if (/middleware|guard|interceptor/.test(lower)) return "middleware";
  if (/auth|permission|role|policy/.test(lower)) return "auth/authz";
  if (/service|usecase/.test(lower)) return "service";
  if (/repository|repo|dao/.test(lower)) return "repository";
  if (/dto|serializer|validator|pydantic/.test(lower)) return "dto/validator";
  if (/config|setting|application\.ya?ml|application\.properties/.test(lower)) return "configuration";
  if (/test|spec/.test(lower)) return "test";
  if (/readme/i.test(lower)) return "documentation";
  if (/package\.json|requirements|pyproject|go\.mod|gemfile|cargo\.toml|pom\.xml|build\.gradle|composer\.json|\.csproj/.test(lower)) return "dependency-manifest";
  if (/prisma|sequelize|typeorm/.test(lower)) return "orm-config";
  if (/\.env/.test(lower)) return "env-template";
  if (/database|db|connection/.test(lower)) return "database-config";
  if (/index|main|app|server|program\.cs/.test(lower)) return "entry-point";
  return "source";
}

function detectFramework(fileTree, packageJson) {
  const paths = fileTree.map((f) => f.path.toLowerCase()).join(" ");
  const deps = packageJson
    ? Object.keys({ ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) })
        .join(" ").toLowerCase()
    : "";
  const all = paths + " " + deps;

  const frameworks = [];
  if (/express/.test(all)) frameworks.push("Express.js");
  if (/fastapi|uvicorn/.test(all)) frameworks.push("FastAPI");
  if (/django/.test(all)) frameworks.push("Django");
  if (/djangorestframework|drf/.test(all)) frameworks.push("Django REST Framework");
  if (/flask/.test(all)) frameworks.push("Flask");
  if (/nestjs|@nestjs/.test(all)) frameworks.push("NestJS");
  if (/hapi/.test(all)) frameworks.push("Hapi.js");
  if (/koa/.test(all)) frameworks.push("Koa.js");
  if (/rails/.test(all)) frameworks.push("Ruby on Rails");
  if (/sinatra/.test(all)) frameworks.push("Sinatra");
  if (/gin-gonic|gin\.go/.test(all)) frameworks.push("Gin (Go)");
  if (/echo\.go|labstack\/echo/.test(all)) frameworks.push("Echo (Go)");
  if (/fiber\.go|gofiber/.test(all)) frameworks.push("Fiber (Go)");
  if (/spring/.test(all)) frameworks.push("Spring Boot");
  if (/laravel/.test(all)) frameworks.push("Laravel");
  if (/symfony/.test(all)) frameworks.push("Symfony");
  if (/next/.test(all)) frameworks.push("Next.js");
  if (/\breact\b/.test(deps)) frameworks.push("React");
  if (/\bvue\b/.test(deps)) frameworks.push("Vue");
  if (/svelte/.test(deps)) frameworks.push("Svelte");
  if (/fastify/.test(deps)) frameworks.push("Fastify");
  if (/asp\.net|microsoft\.aspnetcore/.test(all)) frameworks.push("ASP.NET Core");

  const orms = [];
  if (/prisma/.test(all)) orms.push("Prisma");
  if (/sequelize/.test(all)) orms.push("Sequelize");
  if (/typeorm/.test(all)) orms.push("TypeORM");
  if (/mongoose/.test(all)) orms.push("Mongoose");
  if (/sqlalchemy/.test(all)) orms.push("SQLAlchemy");
  if (/django\.db/.test(all)) orms.push("Django ORM");
  if (/activerecord/.test(all)) orms.push("ActiveRecord");
  if (/gorm/.test(all)) orms.push("GORM (Go)");
  if (/hibernate|jpa/.test(all)) orms.push("Hibernate/JPA");
  if (/entityframework|efcore/.test(all)) orms.push("Entity Framework Core");

  const languages = [];
  if (/\.ts/.test(paths)) languages.push("TypeScript");
  if (/\.js/.test(paths)) languages.push("JavaScript");
  if (/\.py/.test(paths)) languages.push("Python");
  if (/\.go/.test(paths)) languages.push("Go");
  if (/\.rb/.test(paths)) languages.push("Ruby");
  if (/\.java/.test(paths)) languages.push("Java");
  if (/\.php/.test(paths)) languages.push("PHP");
  if (/\.cs/.test(paths)) languages.push("C#");

  return { frameworks, orms, languages };
}

// Truncate at the last full line before the byte budget instead of a raw
// character slice, so a truncated file still parses as valid partial code
// (no mid-string or mid-signature cut) when Claude reads it.
function truncateAtLineBoundary(content, maxLen) {
  if (content.length <= maxLen) return content;
  const cut = content.lastIndexOf("\n", maxLen);
  return content.slice(0, cut > 0 ? cut : maxLen) + "\n// [truncated — too large]";
}

async function getFileContent(octokit, owner, repo, path, ref) {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
    if (data.type !== "file") return null;
    const content = Buffer.from(data.content, "base64").toString("utf8");
    // Capture whole units for later task selection. Never present fragments as
    // complete code; oversized files are reported as unavailable instead.
    if (Buffer.byteLength(content, "utf8") > 128_000) return null;
    return content;
  } catch {
    return null;
  }
}

async function flattenTree(octokit, owner, repo, ref, treeSha) {
  const { data } = await octokit.git.getTree({ owner, repo, tree_sha: treeSha, recursive: "1" });
  if (data.truncated) {
    // GitHub silently caps recursive tree listings (~100k entries). Surface
    // it so a truncated file_tree doesn't get mistaken for the whole repo.
    console.warn(`GitHub tree for ${owner}/${repo}@${ref} was truncated by the API — file list is incomplete.`);
  }
  return (data.tree || []).map((item) => ({
    path: item.path, type: item.type, size: item.size, sha: item.sha,
  }));
}

// Builds a nested folder/file tree from the flat (already-filtered) file
// list, so Claude can read "here's what's inside src/" the way a directory
// listing reads, instead of reconstructing hierarchy from flat path strings.
// Binary/vendor/build noise is already excluded upstream by shouldSkip().
function buildNestedTree(files) {
  const root = { name: "", type: "directory", children: {} };

  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      if (isFile) {
        node.children[part] = {
          type: "file",
          size_bytes: f.size,
          role: isHighValue(f.path) ? inferFileRole(f.path) : null,
        };
      } else {
        if (!node.children[part]) {
          node.children[part] = { name: part, type: "directory", children: {} };
        }
        node = node.children[part];
      }
    }
  }

  // Convert the {children: {name: node}} maps into sorted arrays
  // (directories first, then files, both alphabetical) for stable,
  // readable output.
  function toArray(node) {
    const entries = Object.entries(node.children).map(([name, child]) => {
      if (child.type === "directory") {
        return { name, type: "directory", children: toArray(child) };
      }
      return { name, type: "file", size_bytes: child.size_bytes, role: child.role };
    });
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  return {
    total_files: files.length,
    tree: toArray(root),
  };
}

const ROLE_PRIORITY = {
  "shared-contract": 0, "data-model": 1, "entry-point": 2, "route/controller": 3,
  "middleware": 3, "auth/authz": 3, "service": 4, "repository": 4,
  "orm-config": 5, "database-config": 5, "dto/validator": 6,
  "source": 6, "configuration": 7, "dependency-manifest": 8, "deployment-config": 8,
  "migration": 9, "ci-config": 10, "test": 11, "documentation": 12,
};

async function inspectGitHub({ token, owner, repo, branch, includePaths = [] }) {
  const requested = new Set(includePaths.filter(p => typeof p === 'string' && !p.startsWith('/') && !p.includes('..') && !p.includes('\\') && !shouldSkip(p)).slice(0, 15));
  const octokit = new Octokit({ auth: token });

  const { data: repoData } = await octokit.repos.get({ owner, repo });
  const defaultBranch = branch || repoData.default_branch;

  const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${defaultBranch}` });
  const commitSha = refData.object.sha;
  const { data: commitData } = await octokit.git.getCommit({ owner, repo, commit_sha: commitSha });
  const treeSha = commitData.tree.sha;

  const rawTree = await flattenTree(octokit, owner, repo, defaultBranch, treeSha);
  const allFiles = rawTree.filter((f) => f.type === "blob" && !shouldSkip(f.path));
  const directories = [...new Set(
    rawTree.filter((f) => f.type === "tree" && !shouldSkip(f.path)).map((f) => f.path)
  )].slice(0, 200);

  let packageJson = null;
  const pkgFile = allFiles.filter((f) => /(^|\/)package\.json$/.test(f.path)).sort((a, b) => a.path.length - b.path.length)[0];
  if (pkgFile) {
    const content = await getFileContent(octokit, owner, repo, pkgFile.path, commitSha);
    try { packageJson = JSON.parse(content); } catch { /* ignore */ }
  }

  let requirementsTxt = null;
  const reqFile = rawTree.find((f) => /requirements([-_]?\w*)\.txt$/.test(f.path));
  if (reqFile) {
    requirementsTxt = await getFileContent(octokit, owner, repo, reqFile.path, commitSha);
  }

  let pyprojectToml = null;
  const pyprojectFile = rawTree.find((f) => f.path === "pyproject.toml");
  if (pyprojectFile) {
    pyprojectToml = await getFileContent(octokit, owner, repo, "pyproject.toml", commitSha);
  }

  let goMod = null;
  const goModFile = rawTree.find((f) => f.path === "go.mod");
  if (goModFile) {
    goMod = await getFileContent(octokit, owner, repo, "go.mod", commitSha);
  }

  let gemfile = null;
  const gemfileFile = rawTree.find((f) => /^gemfile$/i.test(f.path));
  if (gemfileFile) {
    gemfile = await getFileContent(octokit, owner, repo, gemfileFile.path, commitSha);
  }

  const stackInfo = detectFramework(allFiles, packageJson);
  const pythonDependencies = [requirementsTxt, pyprojectToml].filter(Boolean).join(" ").toLowerCase();
  for (const [pattern, name] of [[/django/, "Django"], [/djangorestframework/, "Django REST Framework"], [/fastapi/, "FastAPI"], [/flask/, "Flask"]]) {
    if (pattern.test(pythonDependencies) && !stackInfo.frameworks.includes(name)) stackInfo.frameworks.push(name);
  }
  if (/sqlalchemy/.test(pythonDependencies)) stackInfo.orms.push("SQLAlchemy");
  if (/django/.test(pythonDependencies)) stackInfo.orms.push("Django ORM");

  const candidates = allFiles
    .filter((f) => isHighValue(f.path) || /\.(?:[cm]?[jt]sx?|py|rb|go|java|cs|php|rs|vue|svelte|prisma|graphql|gql)$/i.test(f.path))
    .sort((a, b) => {
      const priority = (p) => requested.has(p) ? -1 : ROLE_PRIORITY[inferFileRole(p)] ?? 99;
      return priority(a.path) - priority(b.path);
    })
    ;
  // Reserve coverage across roles rather than spending the entire capture
  // budget on the first directory of a large repository.
  const captureCandidates = candidates.filter((file) => {
    if (/\.d\.ts$/.test(file.path) && allFiles.some((other) => other.path === file.path.replace(/\.d\.ts$/, ".ts"))) return false;
    if (/\.js$/.test(file.path) && allFiles.some((other) => other.path === file.path.replace(/\.js$/, ".ts"))) return false;
    return true;
  });
  const roleCounts = {};
  const highValueFiles = captureCandidates.filter((file) => {
    const role = inferFileRole(file.path);
    const group = role === "route/controller" ? (/routes?\//i.test(file.path) ? "routes" : "controllers") : role;
    roleCounts[group] = (roleCounts[group] || 0) + 1;
    return requested.has(file.path) || roleCounts[group] <= (group === "controllers" ? 100 : 60);
  }).slice(0, 220);

  // Hard budget across ALL file content combined, not just a per-file cap.
  // Files are already priority-sorted (entry points → routes → models →
  // ... → tests/docs), so hitting the budget drops the least important
  // files first rather than truncating arbitrarily. This is what keeps a
  // huge repo from blowing past what's useful to hand to Claude in one go.
  const MAX_TOTAL_CONTENT_BYTES = 2_000_000;
  const BATCH = 10;
  const fileContents = [];
  let totalBytes = 0;
  let budgetExhausted = false;
  const omittedFiles = [];

  for (let i = 0; i < highValueFiles.length; i += BATCH) {
    const batch = highValueFiles.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (f) => {
        const content = f.size > 128_000 ? null : await getFileContent(octokit, owner, repo, f.path, commitSha);
        return { path: f.path, role: inferFileRole(f.path), size_bytes: f.size, sha: f.sha, content: content ?? null };
      })
    );
    for (const r of results) {
      if (r.content === null) { omittedFiles.push({ path: r.path, reason: "unavailable or exceeds 128 KB source limit" }); continue; }
      const size = Buffer.byteLength(r.content, "utf8");
      if (totalBytes + size > MAX_TOTAL_CONTENT_BYTES) {
        budgetExhausted = true;
        omittedFiles.push({ path: r.path, reason: "total capture budget" });
        continue;
      }
      totalBytes += size;
      fileContents.push(r);
    }
  }

  let readme = null;
  const readmeFile = rawTree.find((f) => /^readme\.(md|txt|rst)$/i.test(f.path));
  if (readmeFile) readme = await getFileContent(octokit, owner, repo, readmeFile.path, defaultBranch);

  // Parsed down to {name, inferred_purpose, likely_sensitive} immediately —
  // the raw file content (which a real .env.example occasionally carries a
  // forgotten real value in) is never retained past this call.
  let envVars = [];
  const envFile = rawTree.find((f) => /\.env\.(example|template|sample)$/i.test(f.path));
  if (envFile) {
    const rawEnvContent = await getFileContent(octokit, owner, repo, envFile.path, defaultBranch);
    envVars = parseEnvKeys(rawEnvContent);
  }

  const { data: commits } = await octokit.repos.listCommits({ owner, repo, per_page: 10 });
  const recentCommits = commits.map((c) => ({
    sha: c.sha.slice(0, 8),
    message: c.commit.message.split("\n")[0],
    author: c.commit.author?.name,
    date: c.commit.author?.date,
  }));

  const filesByRole = {};
  for (const f of fileContents) {
    if (!filesByRole[f.role]) filesByRole[f.role] = [];
    filesByRole[f.role].push({ path: f.path, size_bytes: f.size_bytes, sha: f.sha, content: f.content, truncated: false });
  }

  return {
    repository: {
      owner, name: repo, full_name: repoData.full_name, description: repoData.description,
      default_branch: defaultBranch, commit_sha: commitSha, language: repoData.language,
      stars: repoData.stargazers_count, open_issues: repoData.open_issues_count,
      created_at: repoData.created_at, updated_at: repoData.updated_at, topics: repoData.topics,
    },
    stack: {
      ...stackInfo,
      package_json: packageJson
        ? { name: packageJson.name, version: packageJson.version,
            scripts: packageJson.scripts, dependencies: packageJson.dependencies,
            devDependencies: packageJson.devDependencies }
        : null,
      requirements_txt: requirementsTxt,
      pyproject_toml: pyprojectToml,
      go_mod: goMod,
      gemfile,
    },
    file_tree: buildNestedTree(allFiles),
    readme,
    env_vars: envVars,
    key_files_by_role: filesByRole,
    key_files_truncated: budgetExhausted || highValueFiles.length < captureCandidates.length || omittedFiles.length > 0,
    capture: { complete_files: fileContents.length, candidate_files: captureCandidates.length, content_bytes: totalBytes, omitted_files: omittedFiles, requested_paths: [...requested], unavailable_requested_paths: [...requested].filter(p => !fileContents.some(f => f.path === p)), max_file_bytes: 128_000, max_total_bytes: MAX_TOTAL_CONTENT_BYTES },
    recent_commits: recentCommits,
  };
}

module.exports = { inspectGitHub };
