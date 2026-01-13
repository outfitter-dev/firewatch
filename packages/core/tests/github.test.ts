import { expect, test } from "bun:test";

import { GitHubClient, type GraphQLResponse } from "../src/github";

test("fetchReviewThreadMap paginates review thread comments", async () => {
  const client = new GitHubClient("token");
  const calls: {
    query: string;
    variables: Record<string, unknown>;
  }[] = [];
  const responses: GraphQLResponse<unknown>[] = [
    {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: "thread-1",
                  comments: {
                    pageInfo: {
                      hasNextPage: true,
                      endCursor: "cursor-1",
                    },
                    nodes: [{ id: "c1" }, { id: "c2" }],
                  },
                },
              ],
            },
          },
        },
      },
    },
    {
      data: {
        node: {
          comments: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ id: "c3" }],
          },
        },
      },
    },
  ];

  (client as {
    query: <T>(
      query: string,
      variables: Record<string, unknown>
    ) => Promise<GraphQLResponse<T>>;
  }).query = <T,>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<GraphQLResponse<T>> => {
    calls.push({ query, variables });
    const response = responses.shift() as GraphQLResponse<T>;
    return Promise.resolve(response);
  };

  const map = await client.fetchReviewThreadMap(
    "outfitter-dev",
    "firewatch",
    123
  );

  expect(map.get("c1")).toBe("thread-1");
  expect(map.get("c2")).toBe("thread-1");
  expect(map.get("c3")).toBe("thread-1");

  expect(calls[0]?.query.includes("ReviewThreads")).toBe(true);
  expect(calls[1]?.query.includes("ReviewThreadComments")).toBe(true);
  expect(calls[1]?.variables.after).toBe("cursor-1");
});
