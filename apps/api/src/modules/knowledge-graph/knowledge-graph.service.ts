import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCaseCodalLinkDto,
  ListCaseCodalLinksQueryDto,
  UnresolvedCitationsQueryDto,
  UpdateCaseCodalLinkDto,
} from './dto';

/** Minimal node shape used in graph query results. */
interface GraphNode {
  id: string;
  title: string;
  shortTitle: string | null;
  citationText: string | null;
  grNo: string | null;
  documentType: string;
  court: string | null;
  decisionDate: Date | null;
}

/** Edge between two documents (citation link). */
interface GraphEdge {
  id: string;
  fromDocumentId: string;
  toDocumentId: string;
  citationText: string;
  citationType: string;
  confidence: number | null;
}

export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

@Injectable()
export class KnowledgeGraphService {
  private readonly logger = new Logger(KnowledgeGraphService.name);

  private readonly ragServiceUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.ragServiceUrl = this.config.get<string>(
      'RAG_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  // =====================================================================
  // Citation-based Graph Queries
  // =====================================================================

  /**
   * Get all documents cited BY a given document (outgoing citations).
   * BFS traversal up to `depth` levels.
   */
  async getCites(documentId: string, depth = 1): Promise<GraphResult> {
    await this.assertDocumentExists(documentId);
    return this.bfsTraversal(documentId, 'outgoing', Math.min(depth, 3));
  }

  /**
   * Get all documents that CITE a given document (incoming citations).
   * BFS traversal up to `depth` levels.
   */
  async getCitedBy(documentId: string, depth = 1): Promise<GraphResult> {
    await this.assertDocumentExists(documentId);
    return this.bfsTraversal(documentId, 'incoming', Math.min(depth, 3));
  }

  /**
   * Get the full citation chain (both directions) from a document.
   * BFS in both directions up to `depth` levels.
   */
  async getChain(documentId: string, depth = 3): Promise<GraphResult> {
    await this.assertDocumentExists(documentId);

    const [outgoing, incoming] = await Promise.all([
      this.bfsTraversal(documentId, 'outgoing', Math.min(depth, 3)),
      this.bfsTraversal(documentId, 'incoming', Math.min(depth, 3)),
    ]);

    // Merge and deduplicate
    const nodesMap = new Map<string, GraphNode>();
    const edgesMap = new Map<string, GraphEdge>();

    for (const node of [...outgoing.nodes, ...incoming.nodes]) {
      nodesMap.set(node.id, node);
    }
    for (const edge of [...outgoing.edges, ...incoming.edges]) {
      edgesMap.set(edge.id, edge);
    }

    return {
      nodes: Array.from(nodesMap.values()),
      edges: Array.from(edgesMap.values()),
    };
  }

  /**
   * Get the full network graph for visualization.
   * BFS in both directions, returns all connected nodes/edges.
   */
  async getNetwork(documentId: string, depth = 2): Promise<GraphResult> {
    return this.getChain(documentId, depth);
  }

  /**
   * BFS traversal of citation graph using recursive Prisma queries.
   * Depth-limited to prevent runaway queries.
   */
  private async bfsTraversal(
    startDocumentId: string,
    direction: 'outgoing' | 'incoming',
    maxDepth: number,
  ): Promise<GraphResult> {
    const visited = new Set<string>();
    const allNodes = new Map<string, GraphNode>();
    const allEdges = new Map<string, GraphEdge>();
    let frontier = [startDocumentId];

    // Add the start node
    const startDoc = await this.fetchDocumentNode(startDocumentId);
    if (startDoc) {
      allNodes.set(startDoc.id, startDoc);
    }

    for (let currentDepth = 0; currentDepth < maxDepth; currentDepth++) {
      if (frontier.length === 0) break;

      // Mark current frontier as visited
      for (const id of frontier) {
        visited.add(id);
      }

      // Fetch edges from current frontier
      const citations = await this.fetchCitationEdges(frontier, direction);

      const nextFrontier: string[] = [];

      for (const citation of citations) {
        if (!citation.toDocumentId) continue; // Skip unresolved citations

        allEdges.set(citation.id, {
          id: citation.id,
          fromDocumentId: citation.fromDocumentId,
          toDocumentId: citation.toDocumentId,
          citationText: citation.citationText,
          citationType: citation.citationType,
          confidence: citation.confidence,
        });

        // Determine the neighbor document
        const neighborId =
          direction === 'outgoing'
            ? citation.toDocumentId
            : citation.fromDocumentId;

        if (!visited.has(neighborId) && !nextFrontier.includes(neighborId)) {
          nextFrontier.push(neighborId);
        }
      }

      // Fetch node info for new neighbors
      if (nextFrontier.length > 0) {
        const neighborNodes = await this.fetchDocumentNodes(nextFrontier);
        for (const node of neighborNodes) {
          allNodes.set(node.id, node);
        }
      }

      frontier = nextFrontier;
    }

    return {
      nodes: Array.from(allNodes.values()),
      edges: Array.from(allEdges.values()),
    };
  }

  private async fetchCitationEdges(
    documentIds: string[],
    direction: 'outgoing' | 'incoming',
  ) {
    const where: Prisma.CitationWhereInput =
      direction === 'outgoing'
        ? { fromDocumentId: { in: documentIds }, toDocumentId: { not: null } }
        : { toDocumentId: { in: documentIds } };

    return this.prisma.citation.findMany({
      where,
      select: {
        id: true,
        fromDocumentId: true,
        toDocumentId: true,
        citationText: true,
        citationType: true,
        confidence: true,
      },
    });
  }

  private async fetchDocumentNode(
    documentId: string,
  ): Promise<GraphNode | null> {
    return this.prisma.legalDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        title: true,
        shortTitle: true,
        citationText: true,
        grNo: true,
        documentType: true,
        court: true,
        decisionDate: true,
      },
    });
  }

  private async fetchDocumentNodes(
    documentIds: string[],
  ): Promise<GraphNode[]> {
    return this.prisma.legalDocument.findMany({
      where: { id: { in: documentIds } },
      select: {
        id: true,
        title: true,
        shortTitle: true,
        citationText: true,
        grNo: true,
        documentType: true,
        court: true,
        decisionDate: true,
      },
    });
  }

  // =====================================================================
  // Codal Links (case → codal provision mappings)
  // =====================================================================

  /**
   * Get all codal links for a document (as case or as codal).
   */
  async getCodalLinks(documentId: string) {
    await this.assertDocumentExists(documentId);

    const [asCase, asCodal] = await Promise.all([
      this.prisma.caseCodalLink.findMany({
        where: { caseDocumentId: documentId },
        include: {
          codalDocument: {
            select: {
              id: true,
              title: true,
              shortTitle: true,
              citationText: true,
              documentType: true,
            },
          },
          codalSection: {
            select: {
              id: true,
              sectionType: true,
              sectionLabel: true,
              pageStart: true,
              pageEnd: true,
            },
          },
          createdBy: {
            select: { id: true, fullName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.caseCodalLink.findMany({
        where: { codalDocumentId: documentId },
        include: {
          caseDocument: {
            select: {
              id: true,
              title: true,
              shortTitle: true,
              citationText: true,
              grNo: true,
              court: true,
              decisionDate: true,
              documentType: true,
            },
          },
          createdBy: {
            select: { id: true, fullName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { asCase, asCodal };
  }

  // =====================================================================
  // Admin: Case-Codal Link CRUD
  // =====================================================================

  async createCaseCodalLink(dto: CreateCaseCodalLinkDto, userId: string) {
    // Validate both documents exist
    const [caseDoc, codalDoc] = await Promise.all([
      this.prisma.legalDocument.findUnique({
        where: { id: dto.caseDocumentId },
        select: { id: true, documentType: true },
      }),
      this.prisma.legalDocument.findUnique({
        where: { id: dto.codalDocumentId },
        select: { id: true, documentType: true },
      }),
    ]);

    if (!caseDoc) {
      throw new NotFoundException('Case document not found');
    }
    if (!codalDoc) {
      throw new NotFoundException('Codal document not found');
    }

    if (dto.caseDocumentId === dto.codalDocumentId) {
      throw new BadRequestException('Cannot link a document to itself');
    }

    // Validate section if provided
    if (dto.codalSectionId) {
      const sectionCount = await this.prisma.legalDocumentSection.count({
        where: {
          id: dto.codalSectionId,
          legalDocumentId: dto.codalDocumentId,
        },
      });
      if (sectionCount === 0) {
        throw new NotFoundException(
          'Codal section not found or does not belong to the specified codal document',
        );
      }
    }

    return this.prisma.caseCodalLink.create({
      data: {
        caseDocumentId: dto.caseDocumentId,
        codalDocumentId: dto.codalDocumentId,
        codalSectionId: dto.codalSectionId,
        linkType: dto.linkType,
        notes: dto.notes,
        confidence: dto.confidence,
        createdByUserId: userId,
      },
      include: {
        caseDocument: {
          select: {
            id: true,
            title: true,
            citationText: true,
            grNo: true,
          },
        },
        codalDocument: {
          select: {
            id: true,
            title: true,
            citationText: true,
          },
        },
        codalSection: {
          select: {
            id: true,
            sectionType: true,
            sectionLabel: true,
          },
        },
      },
    });
  }

  async updateCaseCodalLink(linkId: string, dto: UpdateCaseCodalLinkDto) {
    const existing = await this.prisma.caseCodalLink.findUnique({
      where: { id: linkId },
    });
    if (!existing) {
      throw new NotFoundException('Case-codal link not found');
    }

    const data: Prisma.CaseCodalLinkUpdateInput = {};
    if (dto.linkType !== undefined) data.linkType = dto.linkType;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.confidence !== undefined) data.confidence = dto.confidence;

    return this.prisma.caseCodalLink.update({
      where: { id: linkId },
      data,
      include: {
        caseDocument: {
          select: { id: true, title: true, citationText: true, grNo: true },
        },
        codalDocument: {
          select: { id: true, title: true, citationText: true },
        },
        codalSection: {
          select: { id: true, sectionType: true, sectionLabel: true },
        },
      },
    });
  }

  async deleteCaseCodalLink(linkId: string) {
    const count = await this.prisma.caseCodalLink.count({
      where: { id: linkId },
    });
    if (count === 0) {
      throw new NotFoundException('Case-codal link not found');
    }

    await this.prisma.caseCodalLink.delete({ where: { id: linkId } });
  }

  async listCaseCodalLinks(query: ListCaseCodalLinksQueryDto) {
    const limit = query.limit ?? 20;

    const where: Prisma.CaseCodalLinkWhereInput = {};
    if (query.caseDocumentId) where.caseDocumentId = query.caseDocumentId;
    if (query.codalDocumentId) where.codalDocumentId = query.codalDocumentId;
    if (query.linkType) where.linkType = query.linkType;

    const items = await this.prisma.caseCodalLink.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        caseDocument: {
          select: {
            id: true,
            title: true,
            citationText: true,
            grNo: true,
            court: true,
            decisionDate: true,
          },
        },
        codalDocument: {
          select: {
            id: true,
            title: true,
            citationText: true,
            documentType: true,
          },
        },
        codalSection: {
          select: {
            id: true,
            sectionType: true,
            sectionLabel: true,
          },
        },
        createdBy: {
          select: { id: true, fullName: true },
        },
      },
    });

    const hasNext = items.length > limit;
    const results = hasNext ? items.slice(0, limit) : items;
    const lastItem = results[results.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items: results,
      meta: { hasNext, nextCursor, limit },
    };
  }

  // =====================================================================
  // Admin: Unresolved Citations
  // =====================================================================

  /**
   * List citations that have not been resolved to a target document.
   */
  async listUnresolvedCitations(query: UnresolvedCitationsQueryDto) {
    const limit = query.limit ?? 20;

    const where: Prisma.CitationWhereInput = {
      toDocumentId: null,
    };
    if (query.citationType) where.citationType = query.citationType;
    if (query.fromDocumentId) where.fromDocumentId = query.fromDocumentId;

    const items = await this.prisma.citation.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        fromDocument: {
          select: {
            id: true,
            title: true,
            citationText: true,
            grNo: true,
            documentType: true,
          },
        },
        fromSection: {
          select: {
            id: true,
            sectionType: true,
            sectionLabel: true,
          },
        },
      },
    });

    const hasNext = items.length > limit;
    const results = hasNext ? items.slice(0, limit) : items;
    const lastItem = results[results.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items: results,
      meta: { hasNext, nextCursor, limit },
    };
  }

  /**
   * Trigger citation resolution for a specific document.
   * Creates a placeholder record; actual resolution handled by Python RAG service.
   */
  async triggerCitationResolution(documentId: string) {
    const document = await this.prisma.legalDocument.findUnique({
      where: { id: documentId },
      select: { id: true, title: true },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Count unresolved citations for this document
    const unresolvedCount = await this.prisma.citation.count({
      where: {
        fromDocumentId: documentId,
        toDocumentId: null,
      },
    });

    // Fetch unresolved citations to send to RAG service
    const unresolvedCitations = await this.prisma.citation.findMany({
      where: {
        fromDocumentId: documentId,
        toDocumentId: null,
      },
      select: {
        id: true,
        citationText: true,
        normalizedCitation: true,
      },
    });

    let resolvedCount = 0;

    if (unresolvedCitations.length > 0) {
      try {
        const url = `${this.ragServiceUrl}/citations/resolve`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            document_id: documentId,
            citations: unresolvedCitations.map((c) => ({
              id: c.id,
              citation_text: c.citationText,
              normalized_citation: c.normalizedCitation,
            })),
          }),
          signal: AbortSignal.timeout(120_000),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`RAG service error ${response.status}: ${body}`);
        }

        const result = (await response.json()) as {
          document_id: string;
          resolved_count: number;
          results: {
            citation_id: string;
            to_document_id: string | null;
            confidence: number;
            resolver_method: string;
            resolved: boolean;
          }[];
        };

        // Update resolved citations in database
        for (const r of result.results) {
          if (r.resolved && r.to_document_id) {
            await this.prisma.citation.update({
              where: { id: r.citation_id },
              data: {
                toDocumentId: r.to_document_id,
                resolvedAt: new Date(),
                resolverMethod: r.resolver_method,
                confidence: r.confidence,
              },
            });
            resolvedCount++;
          }
        }

        this.logger.log(
          `Citation resolution completed: documentId=${documentId}, resolved=${resolvedCount}/${unresolvedCount}`,
        );
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Unknown resolution error';
        this.logger.error(
          `Citation resolution failed for document ${documentId}: ${errorMessage}`,
        );
      }
    } else {
      this.logger.log(
        `No unresolved citations for document ${documentId}`,
      );
    }

    return {
      documentId: document.id,
      documentTitle: document.title,
      unresolvedCitationCount: unresolvedCount,
      resolvedCount,
      status: unresolvedCount === 0 ? 'no_unresolved' : 'completed',
    };
  }

  /**
   * Manually resolve a citation to a target document.
   */
  async resolveCitation(citationId: string, toDocumentId: string) {
    const citation = await this.prisma.citation.findUnique({
      where: { id: citationId },
    });

    if (!citation) {
      throw new NotFoundException('Citation not found');
    }

    const targetDoc = await this.prisma.legalDocument.findUnique({
      where: { id: toDocumentId },
      select: { id: true },
    });

    if (!targetDoc) {
      throw new NotFoundException('Target document not found');
    }

    return this.prisma.citation.update({
      where: { id: citationId },
      data: {
        toDocumentId,
        resolvedAt: new Date(),
        resolverMethod: 'manual',
      },
      include: {
        fromDocument: {
          select: { id: true, title: true, citationText: true },
        },
        toDocument: {
          select: { id: true, title: true, citationText: true },
        },
      },
    });
  }

  // =====================================================================
  // Precedent Trail — Doctrine Evolution Timeline
  // =====================================================================

  /**
   * Build a chronological trail showing how a doctrine evolved across cases.
   *
   * Algorithm:
   * 1. Resolve anchor: documentId → use directly, doctrineId → find linked document,
   *    doctrineText → search for matching doctrine extracts.
   * 2. BFS citation traversal from anchor document (both directions).
   * 3. For each document in the trail, fetch associated doctrine extracts.
   * 4. Sort chronologically by decision date.
   * 5. Infer relationship types between consecutive entries.
   */
  async buildPrecedentTrail(params: {
    documentId?: string;
    doctrineId?: string;
    doctrineText?: string;
    depth?: number;
  }) {
    const maxDepth = Math.min(params.depth ?? 3, 5);

    // Step 1: Resolve anchor document
    let anchorDocumentId: string;

    if (params.documentId) {
      await this.assertDocumentExists(params.documentId);
      anchorDocumentId = params.documentId;
    } else if (params.doctrineId) {
      const doctrine = await this.prisma.doctrineExtract.findUnique({
        where: { id: params.doctrineId },
        select: { legalDocumentId: true },
      });
      if (!doctrine?.legalDocumentId) {
        throw new NotFoundException('Doctrine extract not found or not linked to a document');
      }
      anchorDocumentId = doctrine.legalDocumentId;
    } else if (params.doctrineText) {
      // Search for doctrine by text similarity
      const doctrines = await this.prisma.doctrineExtract.findMany({
        where: {
          text: { contains: params.doctrineText, mode: 'insensitive' as Prisma.QueryMode },
          reviewStatus: 'approved',
          legalDocumentId: { not: null },
        },
        select: { id: true, legalDocumentId: true, text: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      });
      if (doctrines.length === 0 || !doctrines[0]!.legalDocumentId) {
        throw new NotFoundException('No approved doctrine matching the given text');
      }
      anchorDocumentId = doctrines[0]!.legalDocumentId;
    } else {
      throw new BadRequestException(
        'Provide at least one of: documentId, doctrineId, or doctrineText',
      );
    }

    // Step 2: BFS citation traversal in both directions
    const graph = await this.getChain(anchorDocumentId, maxDepth);
    const documentIds = graph.nodes.map((n) => n.id);

    if (documentIds.length === 0) {
      return { anchorDocumentId, trail: [], totalDocuments: 0 };
    }

    // Step 3: Fetch doctrine extracts for all documents in the trail
    const doctrines = await this.prisma.doctrineExtract.findMany({
      where: {
        legalDocumentId: { in: documentIds },
        reviewStatus: { in: ['approved', 'pending_review'] },
      },
      select: {
        id: true,
        text: true,
        normalizedText: true,
        doctrineType: true,
        confidence: true,
        reviewStatus: true,
        legalDocumentId: true,
      },
    });

    // Group doctrines by document
    const doctrinesByDoc = new Map<string, typeof doctrines>();
    for (const d of doctrines) {
      if (!d.legalDocumentId) continue;
      const existing = doctrinesByDoc.get(d.legalDocumentId) ?? [];
      existing.push(d);
      doctrinesByDoc.set(d.legalDocumentId, existing);
    }

    // Step 4: Build trail entries sorted chronologically
    const trailEntries = graph.nodes
      .map((node) => ({
        documentId: node.id,
        title: node.title,
        shortTitle: node.shortTitle,
        citationText: node.citationText,
        grNo: node.grNo,
        court: node.court,
        decisionDate: node.decisionDate,
        doctrines: (doctrinesByDoc.get(node.id) ?? []).map((d) => ({
          id: d.id,
          text: d.text,
          doctrineType: d.doctrineType,
          confidence: d.confidence,
        })),
        isAnchor: node.id === anchorDocumentId,
      }))
      .sort((a, b) => {
        // Sort by decision date ascending (oldest first)
        if (!a.decisionDate && !b.decisionDate) return 0;
        if (!a.decisionDate) return 1;
        if (!b.decisionDate) return -1;
        return new Date(a.decisionDate).getTime() - new Date(b.decisionDate).getTime();
      });

    // Step 5: Infer relationships between consecutive entries
    const trailWithRelationships = trailEntries.map((entry, idx) => {
      let relationship: string | null = null;

      if (idx > 0) {
        const prev = trailEntries[idx - 1]!;

        // Check doctrine links for explicit relationships
        const hasDoctrineLink = this._checkDoctrineRelationship(
          graph.edges,
          prev.documentId,
          entry.documentId,
        );

        if (hasDoctrineLink) {
          relationship = hasDoctrineLink;
        } else if (entry.doctrines.length > 0 && prev.doctrines.length > 0) {
          // Infer from citation direction
          const citesPrev = graph.edges.some(
            (e) =>
              e.fromDocumentId === entry.documentId &&
              e.toDocumentId === prev.documentId,
          );
          relationship = citesPrev ? 'applied' : 'established';
        }
      } else {
        relationship = 'established';
      }

      return { ...entry, relationship };
    });

    this.logger.log(
      `Precedent trail built: anchor=${anchorDocumentId}, documents=${trailWithRelationships.length}`,
    );

    return {
      anchorDocumentId,
      trail: trailWithRelationships,
      totalDocuments: trailWithRelationships.length,
    };
  }

  /**
   * Check if there's an explicit relationship between two documents via doctrine links.
   */
  private _checkDoctrineRelationship(
    edges: GraphEdge[],
    fromDocId: string,
    toDocId: string,
  ): string | null {
    // Check citation type for explicit relationship signals
    const edge = edges.find(
      (e) =>
        (e.fromDocumentId === toDocId && e.toDocumentId === fromDocId) ||
        (e.fromDocumentId === fromDocId && e.toDocumentId === toDocId),
    );

    if (!edge) return null;

    const citationType = edge.citationType?.toLowerCase() ?? '';
    if (citationType.includes('overrul')) return 'overruled';
    if (citationType.includes('modif')) return 'modified';
    if (citationType.includes('distinguish')) return 'distinguished';
    if (citationType.includes('appl')) return 'applied';

    return null;
  }

  // =====================================================================
  // Case-Codal Auto-Suggestion
  // =====================================================================

  /**
   * Call RAG service to suggest codal provisions referenced by a case.
   * Returns suggested links with confidence scores and reasoning.
   */
  async suggestCaseCodalLinks(documentId: string, maxSuggestions = 10) {
    await this.assertDocumentExists(documentId);

    const document = await this.prisma.legalDocument.findUniqueOrThrow({
      where: { id: documentId },
      select: { id: true, title: true, documentType: true },
    });

    if (document.documentType !== 'case') {
      throw new BadRequestException(
        'Case-codal suggestions are only available for case documents',
      );
    }

    try {
      const url = `${this.ragServiceUrl}/citations/suggest-case-codal`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: documentId,
          max_suggestions: Math.min(maxSuggestions, 30),
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`RAG service error ${response.status}: ${body}`);
      }

      const result = (await response.json()) as {
        document_id: string;
        document_title: string;
        suggestions: {
          codal_document_id: string;
          codal_title: string;
          codal_citation: string | null;
          link_type: string;
          relevant_excerpt: string;
          confidence: number;
          reasoning: string;
        }[];
        model_name: string;
        prompt_template_version: string;
      };

      // Record model run for audit
      await this.prisma.modelRun.create({
        data: {
          runType: 'case_codal_suggestion',
          modelName: result.model_name,
          promptTemplateVersion: result.prompt_template_version,
          inputRef: `document:${documentId}`,
          outputRef: `suggestions:${result.suggestions.length}`,
          confidence: null,
        },
      });

      this.logger.log(
        `Case-codal suggestion completed: documentId=${documentId}, suggestions=${result.suggestions.length}`,
      );

      return {
        documentId: result.document_id,
        documentTitle: result.document_title,
        suggestions: result.suggestions,
        modelName: result.model_name,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Case-codal suggestion failed for document ${documentId}: ${errorMessage}`,
      );
      throw new BadRequestException(
        'Case-codal suggestion failed. Please try again later.',
      );
    }
  }

  // =====================================================================
  // Helpers
  // =====================================================================

  private async assertDocumentExists(id: string): Promise<void> {
    const count = await this.prisma.legalDocument.count({ where: { id } });
    if (count === 0) {
      throw new NotFoundException('Legal document not found');
    }
  }
}
