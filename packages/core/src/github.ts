/**
 * GitHub GraphQL client for fetching PR activity.
 *
 * Uses native fetch for minimal dependencies.
 */

const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";

/**
 * GraphQL query for fetching PRs with all activity.
 * Fetches reviews, comments, and commits in a single request.
 */
export const PR_ACTIVITY_QUERY = `
query PRActivity($owner: String!, $repo: String!, $first: Int!, $after: String, $states: [PullRequestState!]) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: $first, after: $after, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        number
        title
        state
        isDraft
        author {
          login
        }
        headRefName
        createdAt
        updatedAt
        url
        labels(first: 20) {
          nodes {
            name
          }
        }
        reviews(first: 50) {
          nodes {
            id
            author {
              login
            }
            body
            state
            createdAt
            updatedAt
          }
        }
        comments(first: 100) {
          nodes {
            id
            author {
              login
            }
            body
            createdAt
            updatedAt
          }
        }
        reviewThreads(first: 100) {
          nodes {
            id
            path
            line
            comments(first: 50) {
              nodes {
                id
                author {
                  login
                }
                body
                createdAt
                updatedAt
              }
            }
          }
        }
        commits(last: 50) {
          nodes {
            commit {
              oid
              message
              author {
                name
                email
              }
              committedDate
            }
          }
        }
      }
    }
  }
}
`;

/**
 * GraphQL response types.
 */
export interface GraphQLResponse<T> {
  data?: T;
  errors?: {
    message: string;
    locations?: { line: number; column: number }[];
    path?: string[];
  }[];
}

export interface PRActivityData {
  repository: {
    pullRequests: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes: PRNode[];
    };
  };
}

export interface PRNode {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  author: { login: string } | null;
  headRefName: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  labels: {
    nodes: {
      name: string;
    }[];
  };
  reviews: {
    nodes: {
      id: string;
      author: { login: string } | null;
      body: string;
      state: string;
      createdAt: string;
      updatedAt: string;
    }[];
  };
  comments: {
    nodes: {
      id: string;
      author: { login: string } | null;
      body: string;
      createdAt: string;
      updatedAt: string;
    }[];
  };
  reviewThreads: {
    nodes: {
      id: string;
      path: string;
      line: number | null;
      comments: {
        nodes: {
          id: string;
          author: { login: string } | null;
          body: string;
          createdAt: string;
          updatedAt: string;
        }[];
      };
    }[];
  };
  commits: {
    nodes: {
      commit: {
        oid: string;
        message: string;
        author: {
          name: string;
          email: string;
        } | null;
        committedDate: string;
      };
    }[];
  };
}

/**
 * GitHub GraphQL client.
 */
export class GitHubClient {
  constructor(private token: string) {}

  /**
   * Execute a GraphQL query.
   */
  async query<T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<GraphQLResponse<T>> {
    const response = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": "firewatch-cli",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`
      );
    }

    return (await response.json()) as GraphQLResponse<T>;
  }

  /**
   * Fetch PR activity for a repository.
   */
  async fetchPRActivity(
    owner: string,
    repo: string,
    options: {
      first?: number;
      after?: string | null;
      states?: ("OPEN" | "CLOSED" | "MERGED")[];
    } = {}
  ): Promise<PRActivityData> {
    const { first = 50, after = null, states = ["OPEN", "CLOSED"] } = options;

    const response = await this.query<PRActivityData>(PR_ACTIVITY_QUERY, {
      owner,
      repo,
      first,
      after,
      states,
    });

    if (response.errors) {
      throw new Error(
        `GraphQL errors: ${response.errors.map((e) => e.message).join(", ")}`
      );
    }

    if (!response.data) {
      throw new Error("No data returned from GitHub API");
    }

    return response.data;
  }
}
