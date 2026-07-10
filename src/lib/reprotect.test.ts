import { describe, expect, it } from "vitest";
import {
  PERMISSION_MASK,
  randomOwnerSecret,
  recipeAfterOwnerUnlock,
  recipeForOpenedDoc,
  type EncryptRecipe,
} from "./reprotect";

// Raw FPDF_GetDocUserPermissions values carry all reserved bits set to 1;
// this mimics a real revision-6 document that only allows printing + copying.
const RAW_PRINT_COPY = (0xfffff000 | 4 | 16) >>> 0;

describe("recipeForOpenedDoc", () => {
  it("returns null when no password was entered (restrictions-only file)", () => {
    expect(
      recipeForOpenedDoc({
        password: "",
        ownerUnlocked: false,
        userPermissions: RAW_PRINT_COPY,
      }),
    ).toBeNull();
  });

  it("reuses an owner-granting password for both passwords", () => {
    const recipe = recipeForOpenedDoc({
      password: "hunter2",
      ownerUnlocked: true,
      userPermissions: 0xffffffff,
    });
    expect(recipe).toEqual({
      kind: "encrypt",
      userPassword: "hunter2",
      ownerPassword: "hunter2",
      permissions: PERMISSION_MASK,
    });
  });

  it("pairs a user-only password with a random owner secret so restrictions keep binding", () => {
    const recipe = recipeForOpenedDoc({
      password: "hunter2",
      ownerUnlocked: false,
      userPermissions: RAW_PRINT_COPY,
    });
    expect(recipe).not.toBeNull();
    expect(recipe!.userPassword).toBe("hunter2");
    expect(recipe!.ownerPassword).not.toBe("hunter2");
    expect(recipe!.ownerPassword.length).toBeGreaterThanOrEqual(32);
  });

  it("uses the injected owner-secret factory", () => {
    const recipe = recipeForOpenedDoc(
      { password: "pw", ownerUnlocked: false, userPermissions: 0 },
      () => "fixed-secret",
    );
    expect(recipe!.ownerPassword).toBe("fixed-secret");
  });

  it("masks reserved permission bits down to the spec table-22 set", () => {
    const recipe = recipeForOpenedDoc({
      password: "pw",
      ownerUnlocked: false,
      userPermissions: RAW_PRINT_COPY,
    });
    expect(recipe!.permissions).toBe(4 | 16);
    // Nothing outside the round-tripped mask may survive.
    expect(recipe!.permissions & ~PERMISSION_MASK).toBe(0);
  });
});

describe("recipeAfterOwnerUnlock", () => {
  it("upgrades an existing recipe's owner password, keeping user password and permissions", () => {
    const existing: EncryptRecipe = {
      kind: "encrypt",
      userPassword: "open-pw",
      ownerPassword: "random-placeholder",
      permissions: 4 | 16,
    };
    expect(
      recipeAfterOwnerUnlock(existing, "open-pw", "real-owner", 0xffffffff),
    ).toEqual({
      kind: "encrypt",
      userPassword: "open-pw",
      ownerPassword: "real-owner",
      permissions: 4 | 16,
    });
  });

  it("creates a faithful recipe for a restrictions-only doc (empty open password)", () => {
    expect(
      recipeAfterOwnerUnlock(undefined, "", "real-owner", RAW_PRINT_COPY),
    ).toEqual({
      kind: "encrypt",
      userPassword: "",
      ownerPassword: "real-owner",
      permissions: 4 | 16,
    });
  });
});

describe("randomOwnerSecret", () => {
  it("produces long, unique, printable secrets", () => {
    const a = randomOwnerSecret();
    const b = randomOwnerSecret();
    expect(a).toMatch(/^[0-9a-f]{36}$/);
    expect(b).toMatch(/^[0-9a-f]{36}$/);
    expect(a).not.toBe(b);
  });
});
