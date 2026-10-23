import {
  findWalletAccount,
  getShortcutTagSuggestions,
  parseShortcutMovement,
} from "./shortcutUtils";

const validShortcut = JSON.stringify([{
  comercio: "Entrada de atajo",
  importe: 12500,
  tarjeta: "Visa principal",
  fecha_hora: "2026-10-23T13:45:00-05:00",
  ubicacion: { latitud: 4.711, longitud: -74.0721 },
}]);

describe("parseShortcutMovement", () => {
  it("normalizes a valid shortcut movement", () => {
    expect(parseShortcutMovement(validShortcut)).toEqual({
      establecimiento: "ENTRADA DE ATAJO",
      valor: 12500,
      tarjeta: "Visa principal",
      fechaHora: "2026-10-23T13:45:00-05:00",
      ubicacion: { latitud: 4.711, longitud: -74.0721 },
    });
  });

  it("rejects invalid JSON", () => {
    expect(() => parseShortcutMovement("not-json")).toThrow("JSON válido");
  });

  it("requires exactly one movement", () => {
    expect(() => parseShortcutMovement("[]")).toThrow("único movimiento");
  });

  it("rejects invalid amounts", () => {
    const invalidAmount = JSON.stringify([{ ...JSON.parse(validShortcut)[0], importe: -10 }]);
    expect(() => parseShortcutMovement(invalidAmount)).toThrow("número entero");
  });

  it("rejects missing coordinates", () => {
    const missingCoordinates = JSON.stringify([{
      ...JSON.parse(validShortcut)[0],
      ubicacion: { latitud: null, longitud: "" },
    }]);
    expect(() => parseShortcutMovement(missingCoordinates)).toThrow("coordenadas válidas");
  });
});

describe("findWalletAccount", () => {
  const accounts = [
    { id: "card-1", banco: "Banco Uno", nombre: "Visa", namewallet: "VISA WALLET 1234", tipoCuenta: "credito" },
    { id: "account-1", banco: "Banco Dos", nombre: "Ahorros", tipoCuenta: "ahorros" },
  ];

  it("matches an account using its Wallet name", () => {
    expect(findWalletAccount(accounts, "Visa Wallet 1234")).toEqual(accounts[0]);
  });

  it("does not guess when the Wallet name is ambiguous", () => {
    expect(findWalletAccount([
      accounts[0],
      { ...accounts[0], id: "card-2" },
    ], "VISA WALLET 1234")).toBeNull();
  });
});

describe("getShortcutTagSuggestions", () => {
  it("suggests tags from similar transactions of the same establishment", () => {
    const history = [
      { establecimiento: "CAFÉ LUNA", valor: 12000, tags: ["COMIDA", "CAFÉ"] },
      { establecimiento: "CAFÉ LUNA", valor: 12500, tags: ["COMIDA"] },
      { establecimiento: "OTRO", valor: 12000, tags: ["TRANSPORTE"] },
    ];

    expect(getShortcutTagSuggestions(history, "CAFÉ LUNA", 12000)).toEqual(["COMIDA", "CAFÉ"]);
  });

  it("returns no suggestions when similar transactions have no tags", () => {
    expect(getShortcutTagSuggestions([
      { establecimiento: "CAFÉ LUNA", valor: 12000, tags: [] },
    ], "CAFÉ LUNA", 12000)).toEqual([]);
  });
});
