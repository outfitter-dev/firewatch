/**
 * GitHub GraphQL client for fetching PR activity.
 *
 * Uses native fetch for minimal dependencies.
 */

const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const GITHUB_REST_ENDPOINT = "https://api.github.com";

/**
 * GitHub PR states as returned by the GraphQL API.
 * This is the single source of truth for valid PR states from GitHub.
 */
export const GITHUB_PR_STATES = ["OPEN", "CLOSED", "MERGED"] as const;
export type GitHubPRState = (typeof GITHUB_PR_STATES)[number];

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
            isResolved
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
                user {
                  login
                }
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

const COMMENT_REACTIONS_QUERY = `
query CommentReactions($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on IssueComment {
      id
      reactions(first: 20, content: THUMBS_UP) {
        nodes {
          user {
            login
          }
        }
      }
    }
    ... on PullRequestReviewComment {
      id
      reactions(first: 20, content: THUMBS_UP) {
        nodes {
          user {
            login
          }
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

const VIEWER_QUERY = `
query Viewer {
  viewer {
    login
  }
}
`;

const CONVERT_PR_TO_DRAFT_MUTATION = `
mutation ConvertPullRequestToDraft($pullRequestId: ID!) {
  convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) {
    pullRequest {
      id
      isDraft
    }
  }
}
`;

const MARK_PR_READY_MUTATION = `
mutation MarkPullRequestReadyForReview($pullRequestId: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
    pullRequest {
      id
      isDraft
    }
  }
}
`;

const CLOSE_PR_MUTATION = `
mutation ClosePullRequest($pullRequestId: ID!) {
  closePullRequest(input: { pullRequestId: $pullRequestId }) {
    pullRequest {
      id
      state
      closed
    }
  }
}
`;

const ADD_REACTION_MUTATION = `
mutation AddReaction($subjectId: ID!, $content: ReactionContent!) {
  addReaction(input: { subjectId: $subjectId, content: $content }) {
    reaction {
      id
      content
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

interface ViewerData {
  viewer: {
    login: string;
  } | null;
}

interface ConvertPullRequestToDraftData {
  convertPullRequestToDraft: {
    pullRequest: {
      id: string;
      isDraft: boolean;
    } | null;
  } | null;
}

interface MarkPullRequestReadyData {
  markPullRequestReadyForReview: {
    pullRequest: {
      id: string;
      isDraft: boolean;
    } | null;
  } | null;
}

interface ClosePullRequestData {
  closePullRequest: {
    pullRequest: {
      id: string;
      state: string;
      closed: boolean;
    } | null;
  } | null;
}

interface AddReactionData {
  addReaction: {
    reaction: {
      id: string;
      content: string;
    } | null;
  } | null;
}

interface CommentReactionsData {
  nodes: ({
    __typename: string;
    id?: string;
    reactions?: {
      nodes: Array<{
        user?: {
          login: string;
        };
      }>;
    };
  } | null)[];
}

/**
 * GitHub reaction content types.
 */
export type ReactionContent =
  | "THUMBS_UP"
  | "THUMBS_DOWN"
  | "LAUGH"
  | "HOORAY"
  | "CONFUSED"
  | "HEART"
  | "ROCKET"
  | "EYES";

export interface PRNode {
  number: number;
  title: string;
  state: GitHubPRState;
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
      isResolved: boolean;
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
          user: { login: string } | null;
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

  private async rest<T>(
    path: string,
    options: {
      method: string;
      body?: unknown;
      headers?: Record<string, string>;
    }
  ): Promise<T | undefined> {
    const response = await fetch(`${GITHUB_REST_ENDPOINT}${path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "firewatch-cli",
        ...options.headers,
      },
      ...(options.body !== undefined && {
        body: JSON.stringify(options.body),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`
      );
    }

    if (response.status === 204) {
      return undefined;
    }

    return (await response.json()) as T;
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
      states?: GitHubPRState[];
    } = {}
  ): Promise<PRActivityData> {
    const {
      first = 50,
      after = null,
      states = [...GITHUB_PR_STATES],
    } = options;

    const response = await this.query<PRActivityData>(PR_ACTIVITY_QUERY, {
      owner,
      repo,
      first,
      after,
      states,
    });

    return GitHubClient.unwrap(response);
  }

  async fetchCommentReactions(
    ids: string[]
  ): Promise<Map<string, { thumbs_up_by: string[] }>> {
    const reactionsById = new Map<string, { thumbs_up_by: string[] }>();
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (uniqueIds.length === 0) {
      return reactionsById;
    }

    const chunkSize = 100;
    for (let i = 0; i < uniqueIds.length; i += chunkSize) {
      const chunk = uniqueIds.slice(i, i + chunkSize);
      const response = await this.query<CommentReactionsData>(
        COMMENT_REACTIONS_QUERY,
        { ids: chunk }
      );

      const data = GitHubClient.unwrap(response);
      for (const node of data.nodes) {
        if (!node?.id || !node.reactions) {
          continue;
        }

        const logins = node.reactions.nodes
          .map((reaction) => reaction.user?.login)
          .filter((login): login is string => Boolean(login));

        if (logins.length === 0) {
          continue;
        }

        reactionsById.set(node.id, { thumbs_up_by: [...new Set(logins)] });
      }
    }

    return reactionsById;
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

  async fetchViewerLogin(): Promise<string> {
    const response = await this.query<ViewerData>(VIEWER_QUERY, {});
    const data = GitHubClient.unwrap(response);
    const login = data.viewer?.login;
    if (!login) {
      throw new Error("No viewer returned from GitHub API");
    }
    return login;
  }

  async convertPullRequestToDraft(pullRequestId: string): Promise<void> {
    const response = await this.query<ConvertPullRequestToDraftData>(
      CONVERT_PR_TO_DRAFT_MUTATION,
      { pullRequestId }
    );

    const data = GitHubClient.unwrap(response);
    if (!data.convertPullRequestToDraft?.pullRequest?.id) {
      throw new Error("Failed to convert PR to draft");
    }
  }

  async markPullRequestReady(pullRequestId: string): Promise<void> {
    const response = await this.query<MarkPullRequestReadyData>(
      MARK_PR_READY_MUTATION,
      { pullRequestId }
    );

    const data = GitHubClient.unwrap(response);
    if (!data.markPullRequestReadyForReview?.pullRequest?.id) {
      throw new Error("Failed to mark PR ready");
    }
  }

  async closePullRequest(pullRequestId: string): Promise<void> {
    const response = await this.query<ClosePullRequestData>(
      CLOSE_PR_MUTATION,
      { pullRequestId }
    );

    const data = GitHubClient.unwrap(response);
    if (!data.closePullRequest?.pullRequest?.id) {
      throw new Error("Failed to close PR");
    }
  }

  async addLabels(
    owner: string,
    repo: string,
    prNumber: number,
    labels: string[]
  ): Promise<void> {
    await this.rest(`/repos/${owner}/${repo}/issues/${prNumber}/labels`, {
      method: "POST",
      body: { labels },
    });
  }

  async removeLabels(
    owner: string,
    repo: string,
    prNumber: number,
    labels: string[]
  ): Promise<void> {
    for (const label of labels) {
      await this.rest(
        `/repos/${owner}/${repo}/issues/${prNumber}/labels/${encodeURIComponent(label)}`,
        { method: "DELETE" }
      );
    }
  }

  async addAssignees(
    owner: string,
    repo: string,
    prNumber: number,
    assignees: string[]
  ): Promise<void> {
    await this.rest(`/repos/${owner}/${repo}/issues/${prNumber}/assignees`, {
      method: "POST",
      body: { assignees },
    });
  }

  async removeAssignees(
    owner: string,
    repo: string,
    prNumber: number,
    assignees: string[]
  ): Promise<void> {
    await this.rest(`/repos/${owner}/${repo}/issues/${prNumber}/assignees`, {
      method: "DELETE",
      body: { assignees },
    });
  }

  async requestReviewers(
    owner: string,
    repo: string,
    prNumber: number,
    reviewers: string[]
  ): Promise<void> {
    await this.rest(
      `/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
      {
        method: "POST",
        body: { reviewers },
      }
    );
  }

  async removeReviewers(
    owner: string,
    repo: string,
    prNumber: number,
    reviewers: string[]
  ): Promise<void> {
    await this.rest(
      `/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
      {
        method: "DELETE",
        body: { reviewers },
      }
    );
  }

  async addReview(
    owner: string,
    repo: string,
    prNumber: number,
    event: "approve" | "request-changes" | "comment",
    body?: string
  ): Promise<{ id: string; url?: string } | null> {
    const eventMap: Record<typeof event, string> = {
      approve: "APPROVE",
      "request-changes": "REQUEST_CHANGES",
      comment: "COMMENT",
    };
    const response = await this.rest<{
      id: number;
      html_url?: string;
    }>(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
      method: "POST",
      body: {
        event: eventMap[event],
        ...(body && { body }),
      },
    });

    if (!response) {
      return null;
    }

    return {
      id: String(response.id),
      ...(response.html_url && { url: response.html_url }),
    };
  }

  async editPullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    updates: { title?: string; body?: string; base?: string }
  ): Promise<void> {
    await this.rest(`/repos/${owner}/${repo}/pulls/${prNumber}`, {
      method: "PATCH",
      body: updates,
    });
  }

  private async resolveMilestoneNumber(
    owner: string,
    repo: string,
    name: string
  ): Promise<number> {
    let page = 1;
    while (page <= 5) {
      const milestones = await this.rest<{ number: number; title: string }[]>(
        `/repos/${owner}/${repo}/milestones?state=all&per_page=100&page=${page}`,
        { method: "GET" }
      );
      if (!milestones || milestones.length === 0) {
        break;
      }
      const match = milestones.find(
        (milestone) => milestone.title.toLowerCase() === name.toLowerCase()
      );
      if (match) {
        return match.number;
      }
      page += 1;
    }
    throw new Error(`Milestone "${name}" not found`);
  }

  async setMilestone(
    owner: string,
    repo: string,
    prNumber: number,
    name: string
  ): Promise<void> {
    const milestone = await this.resolveMilestoneNumber(owner, repo, name);
    await this.rest(`/repos/${owner}/${repo}/issues/${prNumber}`, {
      method: "PATCH",
      body: { milestone },
    });
  }

  async clearMilestone(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<void> {
    await this.rest(`/repos/${owner}/${repo}/issues/${prNumber}`, {
      method: "PATCH",
      body: { milestone: null },
    });
  }

  /**
   * Fetch the list of files changed in a specific commit.
   * Uses the REST API since GraphQL doesn't expose individual commit files easily.
   *
   * @returns Array of file paths changed in the commit, or empty array on error
   */
  async getCommitFiles(
    owner: string,
    repo: string,
    commitSha: string
  ): Promise<string[]> {
    try {
      const data = await this.rest<{
        files?: { filename: string }[];
      }>(`/repos/${owner}/${repo}/commits/${commitSha}`, {
        method: "GET",
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      if (!data) {
        return [];
      }
      return (data.files ?? []).map((f) => f.filename);
    } catch {
      // Return empty array on error - caller will treat as "no file data"
      return [];
    }
  }

  /**
   * Add a reaction to a comment or issue.
   *
   * @param subjectId - The GraphQL node ID of the comment/issue to react to
   * @param content - The reaction type (e.g., "THUMBS_UP")
   * @returns The created reaction ID
   */
  async addReaction(
    subjectId: string,
    content: ReactionContent
  ): Promise<{ id: string; content: string }> {
    const response = await this.query<AddReactionData>(ADD_REACTION_MUTATION, {
      subjectId,
      content,
    });

    const data = GitHubClient.unwrap(response);
    const reaction = data.addReaction?.reaction;
    if (!reaction) {
      throw new Error("No reaction returned from GitHub API");
    }

    return { id: reaction.id, content: reaction.content };
  }
}
