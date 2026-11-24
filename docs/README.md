# Railyard documentation

| Area         | Document                                                   | What it covers                                                                          |
| ------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Product      | [PRD](product/PRD.md)                                      | Vision, personas, goals, scope, success metrics, release plan                           |
| Product      | [Requirements](product/requirements.md)                    | Numbered functional (FR) and non-functional (NFR) requirements with acceptance criteria |
| Product      | [User stories](product/user-stories.md)                    | Epics and Given/When/Then stories                                                       |
| Product      | [Traceability](product/requirements-traceability.md)       | FR -> epic -> ticket -> module -> test -> status                                        |
| Architecture | [Overview](architecture/overview.md)                       | C4 diagrams, module boundaries, request lifecycle                                       |
| Architecture | [Quality attributes](architecture/quality-attributes.md)   | Measurable targets and how they are verified                                            |
| Decisions    | [ADR index](adr/README.md)                                 | Architecture decision records                                                           |
| Design       | [System design](design/system-design.md)                   | State machines, sequences, algorithms and complexity, concurrency                       |
| Design       | [Data model](design/data-model.md)                         | Target ERD, tables, indexes, migrated vs planned                                        |
| API          | [API guide](api/README.md)                                 | Conventions, errors, auth, pagination, SSE, curl examples                               |
| API          | [OpenAPI](api/openapi.yaml)                                | Full target API with `x-status: implemented / pending`                                  |
| Security     | [Threat model](security/threat-model.md)                   | STRIDE, trust boundaries, mitigations, ASVS mapping                                     |
| Testing      | [Test strategy](testing/test-strategy.md)                  | Test pyramid, coverage, acceptance matrix                                               |
| Operations   | [Runbook](operations/runbook.md)                           | Configuration, run/migrate/seed, backup/restore, troubleshooting                        |
| Operations   | [Deployment](operations/deployment.md)                     | systemd + nginx + native PostgreSQL, release and rollback                               |
| Planning     | [Roadmap](planning/roadmap.md)                             | Milestones M0..M8 with exit criteria                                                    |
| Planning     | [Backlog](planning/backlog.md)                             | Every ticket with estimate, status and dependencies                                     |
| Planning     | [Implementation status](planning/implementation-status.md) | What is done, what is stubbed, percentages                                              |
| Planning     | [Risks](planning/risks.md)                                 | Risk register                                                                           |
| Reference    | [Glossary](glossary.md)                                    | Domain vocabulary                                                                       |
