import {
  findWalletAccount,
  findIdentifiedMovementName,
  getIdentifiedMovementNames,
  getShortcutAvailableTags,
  getDefaultCreditInstallments,
  getIdentifiedMovementHistory,
  getIdentifiedMovementTagSuggestions,
  getShortcutTags,
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

  it("accepts the shortcut's localized currency amount and date format", () => {
    const shortcutOutput = `[
      {
        "comercio": "KFC",
        "importe": $ 3.200,
        "tarjeta": "Visa Débito",
        "fecha_hora": "23/10/2026, 17:39",
        "ubicacion": {
          "latitud": 7.100471656254416,
          "longitud": -73.10723809468608
        }
      }
    ]`;

    const parsed = parseShortcutMovement(shortcutOutput);
    expect(parsed).toMatchObject({
      establecimiento: "KFC",
      valor: 3200,
      tarjeta: "Visa Débito",
      ubicacion: { latitud: 7.100471656254416, longitud: -73.10723809468608 },
    });
    expect(new Date(parsed.fechaHora).toLocaleString("es-CO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })).toBe("23/10/2026, 17:39");
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

  it("suggests tags for the recognized place name and excludes unrelated global tags", () => {
    const history = [
      {
        establecimiento: "COMERCIO S.A.S.",
        nombreEstablecimiento: "CAFÉ LUNA",
        valor: 12000,
        tags: ["COMIDA", "CAFÉ"],
      },
      { establecimiento: "OTRO LUGAR", valor: 12000, tags: ["TRANSPORTE"] },
    ];

    expect(getShortcutTagSuggestions(
      history,
      "CAFÉ LUNA",
      12000,
      [],
      []
    )).toEqual(["CAFÉ", "COMIDA"]);
  });

  it("suggests tags using a recognized place matched by the movement location", () => {
    const history = [{
      establecimiento: "KFC",
      valor: 3200,
      tags: ["COMIDA"],
      ubicacion: { latitud: 7.1, longitud: -73.1072 },
    }];
    const places = [{
      establecimientoNormalizado: "KFC",
      nombreLegal: "KFC",
      nombreLugar: "KFC CACIQUE",
      ubicacion: { latitud: 7.10001, longitud: -73.10721 },
    }];

    expect(getShortcutTagSuggestions(
      history,
      "KFC CACIQUE",
      3200,
      [],
      places
    )).toEqual(["COMIDA"]);
  });

  it("does not suggest tags using only the legal name when the recognized name has no match", () => {
    expect(getShortcutTagSuggestions([{
      establecimiento: "KFC",
      nombreLegal: "KFC",
      valor: 3200,
      tags: ["COMIDA"],
    }], "KFC CACIQUE", 3200)).toEqual([]);
  });

  it("matches a recognized establishment name from the saved place name and location", () => {
    const history = [{
      establecimiento: "KFC",
      valor: 3200,
      tags: ["COMIDA"],
      ubicacion: { latitud: 7.1, longitud: -73.1072 },
    }];
    const places = [{
      establecimientoNormalizado: "KFC",
      nombreLegal: "KFC",
      nombreLugar: "KFC CACIQUE",
      ubicacion: { latitud: 7.10001, longitud: -73.10721 },
    }];

    expect(getShortcutTagSuggestions(
      history,
      "KFC",
      3200,
      [],
      places,
      { latitud: 7.1, longitud: -73.1072 }
    )).toEqual(["COMIDA"]);
  });

  it("falls back to tags from the same establishment when amounts differ", () => {
    const history = [
      { establecimiento: "CAFÉ LUNA", valor: 30000, tags: ["COMIDA"] },
      { establecimiento: "CAFÉ LUNA", valor: 40000, tags: ["CAFÉ"] },
    ];

    expect(getShortcutTagSuggestions(history, "CAFÉ LUNA", 5000)).toEqual([
      "CAFÉ",
      "COMIDA",
    ]);
  });

  it("returns no suggestions when similar transactions have no tags", () => {
    expect(getShortcutTagSuggestions([
      { establecimiento: "CAFÉ LUNA", valor: 12000, tags: [] },
    ], "CAFÉ LUNA", 12000)).toEqual([]);
  });

  it("keeps tags separated between places that share a three-letter prefix", () => {
    const history = [
      { establecimiento: "EDS BOLIVAR", valor: 12000, tags: ["BOLIVAR"] },
      { establecimiento: "EDS LA FLORA", valor: 12000, tags: ["LA FLORA"] },
    ];
    const identifiedHistory = getIdentifiedMovementHistory(history);

    expect(getShortcutTagSuggestions(
      identifiedHistory,
      "EDS LA FLORA",
      "12.000"
    )).toEqual(["LA FLORA"]);
  });
});

describe("getIdentifiedMovementTagSuggestions", () => {
  const history = [{
    establecimiento: "KFC",
    nombreLegal: "KFC",
    nombreEstablecimiento: "KFC CACIQUE",
    valor: 3200,
    tags: ["COMIDA"],
  }];

  it("matches Movimientos by the identified place name instead of the legal name", () => {
    expect(getIdentifiedMovementTagSuggestions(history, "KFC CACIQUE", 3200)).toEqual([
      "COMIDA",
    ]);
    expect(getIdentifiedMovementTagSuggestions(history, "KFC", 3200)).toEqual([]);
  });
});

describe("findIdentifiedMovementName", () => {
  it("returns a name only when a three-character prefix has one match", () => {
    const history = [
      { establecimiento: "EDS", nombreEstablecimiento: "EDS BOLIVAR" },
      { establecimiento: "EDS", nombreEstablecimiento: "EDS BOLIVAR" },
      { establecimiento: "EDS", nombreEstablecimiento: "EDS LA FLORA" },
    ];

    expect(getIdentifiedMovementNames(history, "EDS")).toEqual([
      "EDS BOLIVAR",
      "EDS LA FLORA",
    ]);
    expect(findIdentifiedMovementName(history, "EDS")).toBe("");
    expect(findIdentifiedMovementName(history, "EDS LA FLORA")).toBe("EDS LA FLORA");
    expect(findIdentifiedMovementName(history, "KF")).toBe("");
  });

  describe("getDefaultCreditInstallments", () => {
    it("defaults to one installment when the merchant has no prior installment purchase", () => {
      expect(getDefaultCreditInstallments([
        { establecimiento: "KFC", nombreEstablecimiento: "KFC CACIQUE" },
      ], "KFC CACIQUE")).toBe(1);
    });

    it("reuses the largest prior installment count for the identified merchant", () => {
      expect(getDefaultCreditInstallments([
        { nombreEstablecimiento: "KFC CACIQUE", cuotas: 3 },
        { nombreEstablecimiento: "KFC CABECERA", cuotas: 12 },
        { nombreEstablecimiento: "KFC CACIQUE", cuotas: 6 },
      ], "KFC CACIQUE")).toBe(6);
    });
  });

  it("includes a configured place name when history entries only contain its legal name", () => {
    const history = [{
      establecimiento: "ESTACION DEL NORTE",
      valor: 12000,
      tags: ["COMBUSTIBLE"],
      ubicacion: { latitud: 7.1, longitud: -73.1 },
    }];
    const places = [{
      establecimientoNormalizado: "ESTACION DEL NORTE",
      nombreLegal: "ESTACION DEL NORTE",
      nombreLugar: "EDS LA FLORA",
      ubicacion: { latitud: 7.10001, longitud: -73.10001 },
    }];

    expect(getIdentifiedMovementNames(history, "EDS LA FLORA", places)).toEqual([
      "EDS LA FLORA",
    ]);
    expect(getShortcutTagSuggestions(
      getIdentifiedMovementHistory(history, places),
      "EDS LA FLORA",
      12000
    )).toEqual(["COMBUSTIBLE"]);
  });
});

describe("getShortcutAvailableTags", () => {
  it("includes an uncommitted tag and normalizes duplicate tags before saving", () => {
    expect(getShortcutTags(["comida", "CAFÉ"], " comida ")).toEqual([
      "COMIDA",
      "CAFÉ",
    ]);
  });

  it("collects unique tags from movement history and other app tag lists", () => {
    expect(getShortcutAvailableTags([
      { tags: ["comida", "CAFÉ"] },
      { tags: ["COMIDA", "TRANSPORTE"] },
    ], ["ocio", " CAFÉ "])).toEqual([
      "CAFÉ",
      "COMIDA",
      "OCIO",
      "TRANSPORTE",
    ]);
  });
});
