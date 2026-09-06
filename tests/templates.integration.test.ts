import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { deleteOrArchiveTemplate } from "@/lib/services/templates";
import { TestFixtures } from "./helpers/fixtures";

const fixtures = new TestFixtures();
afterEach(() => fixtures.cleanup());

describe("deleteOrArchiveTemplate", () => {
  it("hard-deletes a template that has never been purchased, used, or linked as a next phase", async () => {
    const admin = await fixtures.createUser("ADMIN");
    const template = await fixtures.createTemplate();

    const result = await deleteOrArchiveTemplate(template.id, admin.id);

    expect(result.mode).toBe("deleted");
    expect(await prisma.template.findUnique({ where: { id: template.id } })).toBeNull();
  });

  it("archives (does not delete) a template referenced by an existing trading account", async () => {
    const admin = await fixtures.createUser("ADMIN");
    const trader = await fixtures.createUser("TRADER");
    const template = await fixtures.createTemplate();
    await fixtures.createAccount({ userId: trader.id, template });

    const result = await deleteOrArchiveTemplate(template.id, admin.id);

    expect(result.mode).toBe("archived");
    const stillThere = await prisma.template.findUniqueOrThrow({ where: { id: template.id } });
    expect(stillThere.status).toBe("ARCHIVED");
    expect(stillThere.archivedAt).not.toBeNull();
  });

  it("archives instead of hard-deleting a template that another template still points to as its next phase", async () => {
    // Without this check, this delete would previously reach Postgres's own
    // foreign-key constraint on Template.nextPhaseId and fail with an
    // unhandled error instead of degrading gracefully.
    const admin = await fixtures.createUser("ADMIN");
    const phase2 = await fixtures.createTemplate({ phase: "PHASE_2" });
    await fixtures.createTemplate({ nextPhaseId: phase2.id });

    const result = await deleteOrArchiveTemplate(phase2.id, admin.id);

    expect(result.mode).toBe("archived");
    const stillThere = await prisma.template.findUniqueOrThrow({ where: { id: phase2.id } });
    expect(stillThere.status).toBe("ARCHIVED");
  });
});
