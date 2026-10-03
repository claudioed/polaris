import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FitnessDetails } from "./FitnessDetails";
import {
  catalog,
  criterion,
  fitnessFunction,
  fitnessVersion,
  pullDefinition,
  pushDefinition,
  squad,
} from "../test/fixtures";

describe("FitnessDetails", () => {
  it("renders the active definition, lifecycle, and owning squad", () => {
    render(
      <FitnessDetails
        item={fitnessFunction()}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Checkout availability" })).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("Checkout · Commerce")).toBeInTheDocument();
    expect(screen.getByText("Remain available for customers at all times.")).toBeInTheDocument();
  });

  it("renders enforcement, acquisition, freshness, and activation metrics", () => {
    render(
      <FitnessDetails
        item={fitnessFunction({
          activeVersion: 2,
          versions: [
            fitnessVersion({ number: 1, state: "SUPERSEDED", definition: pushDefinition() }),
            fitnessVersion({
              number: 2,
              definition: pullDefinition({
                name: "Latency budget",
                enforcement: "BLOCK",
                freshnessSeconds: 1800,
              }),
            }),
          ],
        })}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("BLOCK")).toBeInTheDocument();
    expect(screen.getByText("PULL")).toBeInTheDocument();
    expect(screen.getByText("30 min")).toBeInTheDocument();
  });

  it("reports Not activated when the active version was never activated", () => {
    render(
      <FitnessDetails
        item={fitnessFunction({
          versions: [fitnessVersion({ activatedAt: undefined })],
        })}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Not activated")).toBeInTheDocument();
  });

  it("renders criterion cards with comparison labels and warnings", () => {
    render(
      <FitnessDetails
        item={fitnessFunction({
          versions: [
            fitnessVersion({
              definition: pushDefinition({
                criteria: [
                  criterion({
                    key: "p95_latency",
                    unit: "ms",
                    failureComparison: "GREATER_THAN_OR_EQUAL",
                    failureValue: 250,
                    warningValue: 150,
                  }),
                ],
              }),
            }),
          ],
        })}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("p95_latency")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByText("≥ 250 ms")).toBeInTheDocument();
    expect(screen.getByText("Warning at 150 ms")).toBeInTheDocument();
  });

  it("renders the definition history newest first", () => {
    render(
      <FitnessDetails
        item={fitnessFunction({
          versions: [
            fitnessVersion({ number: 1, state: "SUPERSEDED" }),
            fitnessVersion({ number: 2, state: "ACTIVE" }),
          ],
          activeVersion: 2,
        })}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("2 versions")).toBeInTheDocument();
    const rows = screen.getAllByText(/^Version \d$/);
    expect(rows.map((row) => row.textContent)).toEqual(["Version 2", "Version 1"]);
  });

  it("shows protected targets as truncated tags and links to the API resource", () => {
    render(
      <FitnessDetails
        item={fitnessFunction()}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("target-1".slice(0, 8))).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Open API resource/ });
    expect(link).toHaveAttribute("href", "/api/v1/fitness-functions/fn-1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("falls back to Unknown squad when the owner squad is not in the catalog", () => {
    render(
      <FitnessDetails
        item={fitnessFunction({ ownerSquadId: "squad-gone" })}
        catalog={catalog({ squads: [squad({ id: "squad-other" })] })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Unknown squad/)).toBeInTheDocument();
  });

  it("renders nothing when the function has no definition", () => {
    const { container } = render(
      <FitnessDetails
        item={fitnessFunction({ versions: [] })}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("falls back to the raw comparison label for unknown comparisons", () => {
    render(
      <FitnessDetails
        item={fitnessFunction({
          versions: [
            fitnessVersion({
              definition: pushDefinition({
                criteria: [
                  criterion({ failureComparison: "WITHIN", failureValue: 10 }),
                  criterion({ key: "p95_latency", unit: "ms", failureValue: 250 }),
                ],
              }),
            }),
          ],
        })}
        catalog={catalog()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("WITHIN 10 percent")).toBeInTheDocument();
    expect(screen.getByText("2 criteria")).toBeInTheDocument();
  });

  it("closes through the close button", async () => {
    const onClose = vi.fn();
    render(
      <FitnessDetails item={fitnessFunction()} catalog={catalog()} onClose={onClose} />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Close details" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
