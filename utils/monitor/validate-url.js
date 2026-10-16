import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set(["", "80", "443"]);

function isPublicIp(address) {
  try {
    let ip = ipaddr.parse(address);

    if (ip.kind() === "ipv6" && ip.isIPv4MappedAddress()) {
      ip = ip.toIPv4Address();
    }

    // "unicast" exclut notamment les plages privées,
    // loopback, link-local et plusieurs plages réservées.
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}

export async function validatePublicUrl(input) {
  let url;

  try {
    url = new URL(input);
  } catch {
    throw new Error("URL invalide");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error("Seuls HTTP et HTTPS sont autorisés");
  }

  if (url.username || url.password) {
    throw new Error("Les identifiants dans les URL sont interdits");
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    throw new Error("Port non autorisé");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");

  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Nom d'hôte non autorisé");
  }

  // Si l'hôte est déjà une adresse IP, on la contrôle directement.
  if (ipaddr.isValid(hostname)) {
    if (!isPublicIp(hostname)) {
      throw new Error("Adresse IP privée ou réservée interdite");
    }
  } else {
    // Refuse le nom si une seule adresse résolue n'est pas publique.
    let records;

    try {
      records = await dns.lookup(hostname, {
        all: true,
        verbatim: true,
      });
    } catch {
      throw new Error("Impossible de résoudre le nom d'hôte");
    }

    if (
      records.length === 0 ||
      records.some((record) => !isPublicIp(record.address))
    ) {
      throw new Error("L'hôte résout vers une adresse IP non autorisée");
    }
  }

  url.hash = "";

  return url;
}
