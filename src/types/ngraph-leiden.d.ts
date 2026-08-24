declare module "ngraph.leiden" {
  interface LeidenOptions {
    directed?: boolean;
    quality?: "modularity" | "cpm";
    randomSeed?: number;
    linkWeight?: (link: { data?: unknown }) => number;
  }

  interface LeidenClusters {
    getClass(nodeId: string | number): number | undefined;
    getCommunities(): Map<number, Array<string | number>>;
    quality(): number;
  }

  export function detectClusters(
    graph: unknown,
    options?: LeidenOptions,
  ): LeidenClusters;
}
