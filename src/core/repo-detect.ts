import { $ } from "bun";

/**
 * Result of repository detection.
 */
export interface RepoDetectResult {
  /** Detected repository in owner/repo format */
  repo: string | null;
  /** How the repo was detected */
  source: "git" | "package.json" | "Cargo.toml" | "pyproject.toml" | null;
  /** Working directory where detection occurred */
  cwd: string;
}

/**
 * Extract owner/repo from a GitHub URL.
 * Handles both HTTPS and SSH formats.
 */
function parseGitHubUrl(url: string): string | null {
  // SSH: git@github.com:owner/repo.git
  // HTTPS: https://github.com/owner/repo.git
  // HTTPS: https://github.com/owner/repo
  const patterns = [
    /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/,
    /github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/.*)?$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/\.git$/, "");
    }
  }

  return null;
}

/**
 * Detect repo from git remote origin.
 */
async function detectFromGit(cwd: string): Promise<string | null> {
  try {
    const result = await $`git -C ${cwd} remote get-url origin`
      .quiet()
      .nothrow();
    if (result.exitCode !== 0) {
      return null;
    }
    const url = result.stdout.toString().trim();
    return parseGitHubUrl(url);
  } catch {
    return null;
  }
}

/**
 * Find a file by walking up directories from cwd.
 */
async function findFileUp(
  filename: string,
  startDir: string
): Promise<string | null> {
  let dir = startDir;
  const root = "/";

  while (dir !== root) {
    const filePath = `${dir}/${filename}`;
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return filePath;
    }
    dir = dir.slice(0, dir.lastIndexOf("/")) || root;
  }

  return null;
}

/**
 * Detect repo from package.json repository field.
 */
async function detectFromPackageJson(cwd: string): Promise<string | null> {
  const filePath = await findFileUp("package.json", cwd);
  if (!filePath) {
    return null;
  }

  try {
    const file = Bun.file(filePath);
    const content = await file.json();

    // Handle various repository field formats
    const repo = content.repository;
    if (!repo) {
      return null;
    }

    // String format: "owner/repo" or full URL
    if (typeof repo === "string") {
      // Check if it's already owner/repo format
      if (/^[^/]+\/[^/]+$/.test(repo)) {
        return repo;
      }
      return parseGitHubUrl(repo);
    }

    // Object format: { type: "git", url: "..." }
    if (typeof repo === "object" && repo.url) {
      return parseGitHubUrl(repo.url);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect repo from Cargo.toml package.repository field.
 */
async function detectFromCargoToml(cwd: string): Promise<string | null> {
  const filePath = await findFileUp("Cargo.toml", cwd);
  if (!filePath) {
    return null;
  }

  try {
    const file = Bun.file(filePath);
    const content = await file.text();

    // Simple TOML parsing for repository field
    // Look for: repository = "https://github.com/owner/repo"
    const match = content.match(/repository\s*=\s*"([^"]+)"/);
    if (match?.[1]) {
      return parseGitHubUrl(match[1]);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect repo from pyproject.toml project.urls field.
 */
async function detectFromPyprojectToml(cwd: string): Promise<string | null> {
  const filePath = await findFileUp("pyproject.toml", cwd);
  if (!filePath) {
    return null;
  }

  try {
    const file = Bun.file(filePath);
    const content = await file.text();

    // Look for common URL patterns in [project.urls]
    // Repository = "https://github.com/owner/repo"
    // Homepage = "https://github.com/owner/repo"
    // Source = "https://github.com/owner/repo"
    const patterns = [
      /Repository\s*=\s*"([^"]+)"/i,
      /Source\s*=\s*"([^"]+)"/i,
      /Homepage\s*=\s*"([^"]+github\.com[^"]+)"/i,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match?.[1]) {
        const repo = parseGitHubUrl(match[1]);
        if (repo) {
          return repo;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect the current repository from various sources.
 *
 * Detection priority:
 * 1. Git remote origin (most reliable)
 * 2. package.json repository field
 * 3. Cargo.toml package.repository
 * 4. pyproject.toml project.urls
 */
export async function detectRepo(
  cwd: string = process.cwd()
): Promise<RepoDetectResult> {
  // Try git first (most reliable)
  const gitRepo = await detectFromGit(cwd);
  if (gitRepo) {
    return { repo: gitRepo, source: "git", cwd };
  }

  // Try package.json
  const packageRepo = await detectFromPackageJson(cwd);
  if (packageRepo) {
    return { repo: packageRepo, source: "package.json", cwd };
  }

  // Try Cargo.toml
  const cargoRepo = await detectFromCargoToml(cwd);
  if (cargoRepo) {
    return { repo: cargoRepo, source: "Cargo.toml", cwd };
  }

  // Try pyproject.toml
  const pyprojectRepo = await detectFromPyprojectToml(cwd);
  if (pyprojectRepo) {
    return { repo: pyprojectRepo, source: "pyproject.toml", cwd };
  }

  return { repo: null, source: null, cwd };
}
