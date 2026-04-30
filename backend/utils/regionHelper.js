function detectRegion(siteCode) {
  const code = String(siteCode || "").toUpperCase().trim();

  if (code.startsWith("BO") || code.startsWith("CN") || code.startsWith("DU") ||code.startsWith("BI") || code.startsWith("ZO") || code.startsWith("KA")) return "Ankara";
  if (code.startsWith("IZ") || code.startsWith("MU") || code.startsWith("US") || code.startsWith("MN") || code.startsWith("DE") || code.startsWith("AI")) return "İzmir";
  if (code.startsWith("AT") || code.startsWith("IP") || code.startsWith("AF") || code.startsWith("BU")) return "Antalya";

  return "";
}

module.exports = { detectRegion };