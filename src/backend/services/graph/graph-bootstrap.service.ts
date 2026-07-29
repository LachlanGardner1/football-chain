import type { GraphRepository } from "../../domain/repositories";
import type { GraphService } from "./graph-types";

export class GraphBootstrapService {
  private loadedDatasetVersionId: number | null = null;

  constructor(
    private readonly graphRepository: GraphRepository,
    private readonly graphService: GraphService,
  ) {}

  async ensureLoaded(): Promise<void> {
    const datasetVersionId = await this.graphRepository.getActiveDatasetVersionId();

    if (this.loadedDatasetVersionId === datasetVersionId) {
      return;
    }

    const edges = await this.graphRepository.loadPlayerClubEdges(datasetVersionId);

    this.graphService.rebuild({
      datasetVersionId,
      edges,
    });

    this.loadedDatasetVersionId = datasetVersionId;
  }
}
