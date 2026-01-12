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

const PR_ID_QUERY = `
query PullRequestId($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
    }
  }
}
`;

const REVIEW_THREADS_QUERY = `
query ReviewThreads($owner: String!, $repo: String!, $number: Int!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          comments(first: 100) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
            }
          }
        }
      }
    }
  }
}
`;

const REVIEW_THREAD_COMMENTS_QUERY = `
query ReviewThreadComments($threadId: ID!, $first: Int!, $after: String) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      comments(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
        }
      }
    }
  }
}
`;

const ADD_COMMENT_MUTATION = `
mutation AddComment($subjectId: ID!, $body: String!) {
  addComment(input: { subjectId: $subjectId, body: $body }) {
    commentEdge {
      node {
        id
        url
      }
    }
  }
}
`;

const ADD_REVIEW_THREAD_REPLY_MUTATION = `
mutation AddReviewThreadReply($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(
    input: { pullRequestReviewThreadId: $threadId, body: $body }
  ) {
    comment {
      id
      url
    }
  }
}
`;

const RESOLVE_REVIEW_THREAD_MUTATION = `
mutation ResolveReviewThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread {
      id
      isResolved
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

interface PullRequestIdData {
  repository: {
    pullRequest: {
      id: string;
    } | null;
  } | null;
}

interface ReviewThreadsData {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
        nodes: {
          id: string;
          comments: {
            pageInfo: {
              hasNextPage: boolean;
              endCursor: string | null;
            };
            nodes: {
              id: string;
            }[];
          };
        }[];
      };
    } | null;
  } | null;
}

interface ReviewThreadCommentsData {
  node: {
    comments: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes: {
        id: string;
      }[];
    };
  } | null;
}

interface AddCommentData {
  addComment: {
    commentEdge: {
      node: {
        id: string;
        url: string | null;
      };
    } | null;
  } | null;
}

interface AddReviewThreadReplyData {
  addPullRequestReviewThreadReply: {
    comment: {
      id: string;
      url: string | null;
    } | null;
  } | null;
}

interface ResolveReviewThreadData {
  resolveReviewThread: {
    thread: {
      id: string;
      isResolved: boolean;
    } | null;
  } | null;
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

  private static unwrap<T>(response: GraphQLResponse<T>): T {
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

    return GitHubClient.unwrap(response);
  }

  async fetchPullRequestId(
    owner: string,
    repo: string,
    number: number
  ): Promise<string> {
    const response = await this.query<PullRequestIdData>(PR_ID_QUERY, {
      owner,
      repo,
      number,
    });

    const data = GitHubClient.unwrap(response);
    const prId = data.repository?.pullRequest?.id;
    if (!prId) {
      throw new Error(`Pull request ${owner}/${repo}#${number} not found`);
    }
    return prId;
  }

  async fetchReviewThreadMap(
    owner: string,
    repo: string,
    number: number
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    let after: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const response: GraphQLResponse<ReviewThreadsData> =
        await this.query<ReviewThreadsData>(REVIEW_THREADS_QUERY, {
          owner,
          repo,
          number,
          first: 50,
          after,
        });

      const data: ReviewThreadsData = GitHubClient.unwrap(response);
      const threads = data.repository?.pullRequest?.reviewThreads;
      if (!threads) {
        throw new Error(`Pull request ${owner}/${repo}#${number} not found`);
      }

      for (const thread of threads.nodes) {
        for (const comment of thread.comments.nodes) {
          map.set(comment.id, thread.id);
        }

        let commentCursor = thread.comments.pageInfo.endCursor;
        let hasMoreComments = thread.comments.pageInfo.hasNextPage;

        while (hasMoreComments) {
          const response: GraphQLResponse<ReviewThreadCommentsData> =
            await this.query<ReviewThreadCommentsData>(
              REVIEW_THREAD_COMMENTS_QUERY,
              {
                threadId: thread.id,
                first: 100,
                after: commentCursor,
              }
            );

          const data: ReviewThreadCommentsData = GitHubClient.unwrap(response);
          const comments = data.node?.comments;
          if (!comments) {
            break;
          }

          for (const comment of comments.nodes) {
            map.set(comment.id, thread.id);
          }

          hasMoreComments = comments.pageInfo.hasNextPage;
          commentCursor = comments.pageInfo.endCursor;
        }
      }

      hasNextPage = threads.pageInfo.hasNextPage;
      after = threads.pageInfo.endCursor;
    }

    return map;
  }

  async addIssueComment(
    subjectId: string,
    body: string
  ): Promise<{ id: string; url?: string }> {
    const response = await this.query<AddCommentData>(ADD_COMMENT_MUTATION, {
      subjectId,
      body,
    });

    const data = GitHubClient.unwrap(response);
    const node = data.addComment?.commentEdge?.node;
    if (!node) {
      throw new Error("No comment returned from GitHub API");
    }

    return { id: node.id, ...(node.url && { url: node.url }) };
  }

  async addReviewThreadReply(
    threadId: string,
    body: string
  ): Promise<{ id: string; url?: string }> {
    const response = await this.query<AddReviewThreadReplyData>(
      ADD_REVIEW_THREAD_REPLY_MUTATION,
      {
        threadId,
        body,
      }
    );

    const data = GitHubClient.unwrap(response);
    const comment = data.addPullRequestReviewThreadReply?.comment;
    if (!comment) {
      throw new Error("No reply returned from GitHub API");
    }

    return { id: comment.id, ...(comment.url && { url: comment.url }) };
  }

  async resolveReviewThread(threadId: string): Promise<void> {
    const response = await this.query<ResolveReviewThreadData>(
      RESOLVE_REVIEW_THREAD_MUTATION,
      { threadId }
    );

    const data = GitHubClient.unwrap(response);
    if (!data.resolveReviewThread?.thread?.id) {
      throw new Error("No thread returned from GitHub API");
    }
  }
}
