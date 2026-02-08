/**
 * GitHub GraphQL client for fetching PR activity.
 *
 * Uses native fetch for minimal dependencies.
 */

import {
  Result,
  NetworkError,
  NotFoundError,
} from "@outfitter/contracts";

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
            databaseId
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
                databaseId
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
      nodes: {
        user?: {
          login: string;
        };
      }[];
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
      databaseId: number;
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
          databaseId: number;
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

  private static unwrap<T>(
    response: GraphQLResponse<T>
  ): Result<T, NetworkError> {
    if (response.errors) {
      return Result.err(
        new NetworkError({
          message: `GraphQL errors: ${response.errors.map((e) => e.message).join(", ")}`,
        })
      );
    }

    if (!response.data) {
      return Result.err(
        new NetworkError({ message: "No data returned from GitHub API" })
      );
    }

    return Result.ok(response.data);
  }

  /**
   * Execute a GraphQL query.
   */
  async query<T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<Result<GraphQLResponse<T>, NetworkError>> {
    try {
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
        return Result.err(
          new NetworkError({
            message: `GitHub API error: ${response.status} ${response.statusText}`,
          })
        );
      }

      const json = (await response.json()) as GraphQLResponse<T>;
      return Result.ok(json);
    } catch (error) {
      return Result.err(
        new NetworkError({
          message: `Network error: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  private async rest<T = void>(
    path: string,
    options: {
      method: string;
      body?: unknown;
      headers?: Record<string, string>;
    }
  ): Promise<Result<T, NetworkError>> {
    try {
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
        return Result.err(
          new NetworkError({
            message: `GitHub API error: ${response.status} ${response.statusText}`,
          })
        );
      }

      if (response.status === 204) {
        // For void responses (DELETE, some POST operations)
        return Result.ok() as Result<T, NetworkError>;
      }

      const json = (await response.json()) as T;
      return Result.ok(json);
    } catch (error) {
      return Result.err(
        new NetworkError({
          message: `Network error: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
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
  ): Promise<Result<PRActivityData, NetworkError>> {
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

    if (response.isErr()) {return response;}
    return GitHubClient.unwrap(response.value);
  }

  async fetchCommentReactions(
    ids: string[]
  ): Promise<Result<Map<string, { thumbs_up_by: string[] }>, NetworkError>> {
    const reactionsById = new Map<string, { thumbs_up_by: string[] }>();
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (uniqueIds.length === 0) {
      return Result.ok(reactionsById);
    }

    const chunkSize = 100;
    for (let i = 0; i < uniqueIds.length; i += chunkSize) {
      const chunk = uniqueIds.slice(i, i + chunkSize);
      const response = await this.query<CommentReactionsData>(
        COMMENT_REACTIONS_QUERY,
        { ids: chunk }
      );

      if (response.isErr()) {return Result.err(response.error);}

      const data = GitHubClient.unwrap(response.value);
      if (data.isErr()) {return data;}

      for (const node of data.value.nodes) {
        if (!node?.id || !node.reactions) {
          continue;
        }

        const logins = node.reactions.nodes
          .map((reaction) => reaction.user?.login)
          .filter(
            (login): login is string => login !== undefined && login !== ""
          );

        if (logins.length === 0) {
          continue;
        }

        reactionsById.set(node.id, { thumbs_up_by: [...new Set(logins)] });
      }
    }

    return Result.ok(reactionsById);
  }

  async fetchPullRequestId(
    owner: string,
    repo: string,
    number: number
  ): Promise<Result<string, NetworkError | NotFoundError>> {
    const response = await this.query<PullRequestIdData>(PR_ID_QUERY, {
      owner,
      repo,
      number,
    });

    if (response.isErr()) {return response;}

    const data = GitHubClient.unwrap(response.value);
    if (data.isErr()) {return data;}

    const prId = data.value.repository?.pullRequest?.id;
    if (!prId) {
      return Result.err(
        new NotFoundError({
          message: `Pull request not found: ${owner}/${repo}#${number}`,
          resourceType: "pull request",
          resourceId: `${owner}/${repo}#${number}`,
        })
      );
    }
    return Result.ok(prId);
  }

  async fetchReviewThreadMap(
    owner: string,
    repo: string,
    number: number
  ): Promise<Result<Map<string, string>, NetworkError | NotFoundError>> {
    const map = new Map<string, string>();
    let after: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const response: Result<GraphQLResponse<ReviewThreadsData>, NetworkError> =
        await this.query<ReviewThreadsData>(REVIEW_THREADS_QUERY, {
          owner,
          repo,
          number,
          first: 50,
          after,
        });

      if (response.isErr()) {return Result.err(response.error);}

      const data: Result<ReviewThreadsData, NetworkError> =
        GitHubClient.unwrap(response.value);
      if (data.isErr()) {return data;}

      const threads:
        | {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: {
              id: string;
              comments: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                nodes: { id: string }[];
              };
            }[];
          }
        | null
        | undefined = data.value.repository?.pullRequest?.reviewThreads;
      if (!threads) {
        return Result.err(
          new NotFoundError({
            message: `Pull request not found: ${owner}/${repo}#${number}`,
            resourceType: "pull request",
            resourceId: `${owner}/${repo}#${number}`,
          })
        );
      }

      for (const thread of threads.nodes) {
        for (const comment of thread.comments.nodes) {
          map.set(comment.id, thread.id);
        }

        let commentCursor = thread.comments.pageInfo.endCursor;
        let hasMoreComments = thread.comments.pageInfo.hasNextPage;

        while (hasMoreComments) {
          const commentResponse = await this.query<ReviewThreadCommentsData>(
            REVIEW_THREAD_COMMENTS_QUERY,
            {
              threadId: thread.id,
              first: 100,
              after: commentCursor,
            }
          );

          if (commentResponse.isErr()) {return Result.err(commentResponse.error);}

          const commentData = GitHubClient.unwrap(commentResponse.value);
          if (commentData.isErr()) {return commentData;}

          const comments = commentData.value.node?.comments;
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

    return Result.ok(map);
  }

  async addIssueComment(
    subjectId: string,
    body: string
  ): Promise<
    Result<{ id: string; url?: string }, NetworkError | NotFoundError>
  > {
    const response = await this.query<AddCommentData>(ADD_COMMENT_MUTATION, {
      subjectId,
      body,
    });

    if (response.isErr()) {return response;}

    const data = GitHubClient.unwrap(response.value);
    if (data.isErr()) {return data;}

    const node = data.value.addComment?.commentEdge?.node;
    if (!node) {
      return Result.err(
        new NotFoundError({
          message: "No comment returned from GitHub API",
          resourceType: "comment",
          resourceId: subjectId,
        })
      );
    }

    return Result.ok({ id: node.id, ...(node.url && { url: node.url }) });
  }

  async addReviewThreadReply(
    threadId: string,
    body: string
  ): Promise<
    Result<{ id: string; url?: string }, NetworkError | NotFoundError>
  > {
    const response = await this.query<AddReviewThreadReplyData>(
      ADD_REVIEW_THREAD_REPLY_MUTATION,
      {
        threadId,
        body,
      }
    );

    if (response.isErr()) {return response;}

    const data = GitHubClient.unwrap(response.value);
    if (data.isErr()) {return data;}

    const comment = data.value.addPullRequestReviewThreadReply?.comment;
    if (!comment) {
      return Result.err(
        new NotFoundError({
          message: "No reply returned from GitHub API",
          resourceType: "reply",
          resourceId: threadId,
        })
      );
    }

    return Result.ok({
      id: comment.id,
      ...(comment.url && { url: comment.url }),
    });
  }

  async resolveReviewThread(
    threadId: string
  ): Promise<Result<void, NetworkError | NotFoundError>> {
    const response = await this.query<ResolveReviewThreadData>(
      RESOLVE_REVIEW_THREAD_MUTATION,
      { threadId }
    );

    if (response.isErr()) {return response;}

    const data = GitHubClient.unwrap(response.value);
    if (data.isErr()) {return data;}

    if (!data.value.resolveReviewThread?.thread?.id) {
      return Result.err(
        new NotFoundError({
          message: `Thread not found: ${threadId}`,
          resourceType: "thread",
          resourceId: threadId,
        })
      );
    }
    return Result.ok();
  }

  async fetchViewerLogin(): Promise<
    Result<string, NetworkError | NotFoundError>
  > {
    const response = await this.query<ViewerData>(VIEWER_QUERY, {});

    if (response.isErr()) {return response;}

    const data = GitHubClient.unwrap(response.value);
    if (data.isErr()) {return data;}

    const login = data.value.viewer?.login;
    if (!login) {
      return Result.err(
        new NotFoundError({
          message: "No viewer returned from GitHub API",
          resourceType: "viewer",
          resourceId: "current",
        })
      );
    }
    return Result.ok(login);
  }

  async convertPullRequestToDraft(
    pullRequestId: string
  ): Promise<Result<void, NetworkError | NotFoundError>> {
    const response = await this.query<ConvertPullRequestToDraftData>(
      CONVERT_PR_TO_DRAFT_MUTATION,
      { pullRequestId }
    );

    if (response.isErr()) {return response;}

    const data = GitHubClient.unwrap(response.value);
    if (data.isErr()) {return data;}

    if (!data.value.convertPullRequestToDraft?.pullRequest?.id) {
      return Result.err(
        new NotFoundError({
          message: "Failed to convert PR to draft",
          resourceType: "pull request",
          resourceId: pullRequestId,
        })
      );
    }
    return Result.ok();
  }

  async markPullRequestReady(
    pullRequestId: string
  ): Promise<Result<void, NetworkError | NotFoundError>> {
    const response = await this.query<MarkPullRequestReadyData>(
      MARK_PR_READY_MUTATION,
      { pullRequestId }
    );

    if (response.isErr()) {return response;}

    const data = GitHubClient.unwrap(response.value);
    if (data.isErr()) {return data;}

    if (!data.value.markPullRequestReadyForReview?.pullRequest?.id) {
      return Result.err(
        new NotFoundError({
          message: "Failed to mark PR ready",
          resourceType: "pull request",
          resourceId: pullRequestId,
        })
      );
    }
    return Result.ok();
  }

  async closePullRequest(
    pullRequestId: string
  ): Promise<Result<void, NetworkError | NotFoundError>> {
    const response = await this.query<ClosePullRequestData>(CLOSE_PR_MUTATION, {
      pullRequestId,
    });

    if (response.isErr()) {return response;}

    const data = GitHubClient.unwrap(response.value);
    if (data.isErr()) {return data;}

    if (!data.value.closePullRequest?.pullRequest?.id) {
      return Result.err(
        new NotFoundError({
          message: "Failed to close PR",
          resourceType: "pull request",
          resourceId: pullRequestId,
        })
      );
    }
    return Result.ok();
  }

  async addLabels(
    owner: string,
    repo: string,
    prNumber: number,
    labels: string[]
  ): Promise<Result<void, NetworkError>> {
    const result = await this.rest(
      `/repos/${owner}/${repo}/issues/${prNumber}/labels`,
      {
        method: "POST",
        body: { labels },
      }
    );
    if (result.isErr()) {return result;}
    return Result.ok();
  }

  async removeLabels(
    owner: string,
    repo: string,
    prNumber: number,
    labels: string[]
  ): Promise<Result<void, NetworkError>> {
    for (const label of labels) {
      const result = await this.rest(
        `/repos/${owner}/${repo}/issues/${prNumber}/labels/${encodeURIComponent(label)}`,
        { method: "DELETE" }
      );
      if (result.isErr()) {return result;}
    }
    return Result.ok();
  }

  async addAssignees(
    owner: string,
    repo: string,
    prNumber: number,
    assignees: string[]
  ): Promise<Result<void, NetworkError>> {
    const result = await this.rest(
      `/repos/${owner}/${repo}/issues/${prNumber}/assignees`,
      {
        method: "POST",
        body: { assignees },
      }
    );
    if (result.isErr()) {return result;}
    return Result.ok();
  }

  async removeAssignees(
    owner: string,
    repo: string,
    prNumber: number,
    assignees: string[]
  ): Promise<Result<void, NetworkError>> {
    const result = await this.rest(
      `/repos/${owner}/${repo}/issues/${prNumber}/assignees`,
      {
        method: "DELETE",
        body: { assignees },
      }
    );
    if (result.isErr()) {return result;}
    return Result.ok();
  }

  async requestReviewers(
    owner: string,
    repo: string,
    prNumber: number,
    reviewers: string[]
  ): Promise<Result<void, NetworkError>> {
    const result = await this.rest(
      `/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
      {
        method: "POST",
        body: { reviewers },
      }
    );
    if (result.isErr()) {return result;}
    return Result.ok();
  }

  async removeReviewers(
    owner: string,
    repo: string,
    prNumber: number,
    reviewers: string[]
  ): Promise<Result<void, NetworkError>> {
    const result = await this.rest(
      `/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
      {
        method: "DELETE",
        body: { reviewers },
      }
    );
    if (result.isErr()) {return result;}
    return Result.ok();
  }

  async addReview(
    owner: string,
    repo: string,
    prNumber: number,
    event: "approve" | "request-changes" | "comment",
    body?: string
  ): Promise<Result<{ id: string; url?: string } | null, NetworkError>> {
    const eventMap: Record<typeof event, string> = {
      approve: "APPROVE",
      "request-changes": "REQUEST_CHANGES",
      comment: "COMMENT",
    };
    const result = await this.rest<{
      id: number;
      html_url?: string;
    }>(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
      method: "POST",
      body: {
        event: eventMap[event],
        ...(body && { body }),
      },
    });

    if (result.isErr()) {return result;}

    const response = result.value;
    if (!response) {
      return Result.ok(null);
    }

    return Result.ok({
      id: String(response.id),
      ...(response.html_url && { url: response.html_url }),
    });
  }

  async editPullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    updates: { title?: string; body?: string; base?: string }
  ): Promise<Result<void, NetworkError>> {
    const result = await this.rest(
      `/repos/${owner}/${repo}/pulls/${prNumber}`,
      {
        method: "PATCH",
        body: updates,
      }
    );
    if (result.isErr()) {return result;}
    return Result.ok();
  }

  private async resolveMilestoneNumber(
    owner: string,
    repo: string,
    name: string
  ): Promise<Result<number, NetworkError | NotFoundError>> {
    let page = 1;
    while (page <= 5) {
      const result = await this.rest<{ number: number; title: string }[]>(
        `/repos/${owner}/${repo}/milestones?state=all&per_page=100&page=${page}`,
        { method: "GET" }
      );

      if (result.isErr()) {return result;}

      const milestones = result.value;
      if (!milestones || milestones.length === 0) {
        break;
      }
      const match = milestones.find(
        (milestone) => milestone.title.toLowerCase() === name.toLowerCase()
      );
      if (match) {
        return Result.ok(match.number);
      }
      page += 1;
    }
    return Result.err(
      new NotFoundError({
        message: `Milestone not found: ${name}`,
        resourceType: "milestone",
        resourceId: name,
      })
    );
  }

  async setMilestone(
    owner: string,
    repo: string,
    prNumber: number,
    name: string
  ): Promise<Result<void, NetworkError | NotFoundError>> {
    const milestoneResult = await this.resolveMilestoneNumber(
      owner,
      repo,
      name
    );
    if (milestoneResult.isErr()) {return milestoneResult;}

    const result = await this.rest(
      `/repos/${owner}/${repo}/issues/${prNumber}`,
      {
        method: "PATCH",
        body: { milestone: milestoneResult.value },
      }
    );
    if (result.isErr()) {return result;}
    return Result.ok();
  }

  async clearMilestone(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Result<void, NetworkError>> {
    const result = await this.rest(
      `/repos/${owner}/${repo}/issues/${prNumber}`,
      {
        method: "PATCH",
        body: { milestone: null },
      }
    );
    if (result.isErr()) {return result;}
    return Result.ok();
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
      const result = await this.rest<{
        files?: { filename: string }[];
      }>(`/repos/${owner}/${repo}/commits/${commitSha}`, {
        method: "GET",
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      if (result.isErr()) {
        return [];
      }
      const data = result.value;
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
  ): Promise<
    Result<{ id: string; content: string }, NetworkError | NotFoundError>
  > {
    const response = await this.query<AddReactionData>(ADD_REACTION_MUTATION, {
      subjectId,
      content,
    });

    if (response.isErr()) {return response;}

    const data = GitHubClient.unwrap(response.value);
    if (data.isErr()) {return data;}

    const reaction = data.value.addReaction?.reaction;
    if (!reaction) {
      return Result.err(
        new NotFoundError({
          message: "No reaction returned from GitHub API",
          resourceType: "reaction",
          resourceId: subjectId,
        })
      );
    }

    return Result.ok({ id: reaction.id, content: reaction.content });
  }

  /**
   * Edit an issue comment body.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param commentId - The numeric REST API comment ID
   * @param body - The new comment body
   */
  async editIssueComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string
  ): Promise<
    Result<{ id: number; body: string }, NetworkError | NotFoundError>
  > {
    const result = await this.rest<{ id: number; body: string }>(
      `/repos/${owner}/${repo}/issues/comments/${commentId}`,
      {
        method: "PATCH",
        body: { body },
      }
    );
    if (result.isErr()) {return result;}
    if (!result.value) {
      return Result.err(
        new NotFoundError({
          message: "No response from GitHub API",
          resourceType: "comment",
          resourceId: String(commentId),
        })
      );
    }
    return Result.ok(result.value);
  }

  /**
   * Edit a pull request review comment body.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param commentId - The numeric REST API comment ID
   * @param body - The new comment body
   */
  async editReviewComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string
  ): Promise<
    Result<{ id: number; body: string }, NetworkError | NotFoundError>
  > {
    const result = await this.rest<{ id: number; body: string }>(
      `/repos/${owner}/${repo}/pulls/comments/${commentId}`,
      {
        method: "PATCH",
        body: { body },
      }
    );
    if (result.isErr()) {return result;}
    if (!result.value) {
      return Result.err(
        new NotFoundError({
          message: "No response from GitHub API",
          resourceType: "comment",
          resourceId: String(commentId),
        })
      );
    }
    return Result.ok(result.value);
  }

  /**
   * Delete an issue comment.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param commentId - The numeric REST API comment ID
   */
  async deleteIssueComment(
    owner: string,
    repo: string,
    commentId: number
  ): Promise<Result<void, NetworkError>> {
    const result = await this.rest(
      `/repos/${owner}/${repo}/issues/comments/${commentId}`,
      {
        method: "DELETE",
      }
    );
    if (result.isErr()) {return result;}
    return Result.ok();
  }

  /**
   * Delete a pull request review comment.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param commentId - The numeric REST API comment ID
   */
  async deleteReviewComment(
    owner: string,
    repo: string,
    commentId: number
  ): Promise<Result<void, NetworkError>> {
    const result = await this.rest(
      `/repos/${owner}/${repo}/pulls/comments/${commentId}`,
      {
        method: "DELETE",
      }
    );
    if (result.isErr()) {return result;}
    return Result.ok();
  }
}
