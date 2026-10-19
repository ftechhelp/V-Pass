import Foundation

/// Which saved logins belong to the site the user is on (`tools/url-match.ts`).
/// Used by AutoFill to rank logins for the service identifiers iOS hands over.

/// How closely a saved URL matches the page, best first.
public enum UrlMatchKind: Int, Sendable, Comparable {
	case origin = 0, host = 1, domain = 2

	public static func < (a: UrlMatchKind, b: UrlMatchKind) -> Bool { a.rawValue < b.rawValue }
}

public struct UrlMatch: Sendable, Equatable {
	public var kind: UrlMatchKind
	/// The saved URL is https but the page is plain http: fill only after confirmation.
	public var insecure: Bool
}

/// An http(s) URL reduced to what matching needs, normalised like the WHATWG URL parser.
struct WebURL: Equatable {
	var scheme: String
	var hostname: String
	var port: Int?

	init?(_ text: String) {
		guard let components = URLComponents(string: normaliseUrl(text)),
			let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http",
			let hostname = components.host?.lowercased(), !hostname.isEmpty else {
			return nil
		}
		self.scheme = scheme
		self.hostname = hostname
		let defaultPort = scheme == "https" ? 443 : 80
		port = components.port == defaultPort ? nil : components.port
	}

	/// `host` in WHATWG terms: hostname plus a non-default port.
	var host: String { port.map { "\(hostname):\($0)" } ?? hostname }
	var origin: String { "\(scheme)://\(host)" }
}

private func stripWww(_ host: String) -> String {
	host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
}

/// eTLD+1 (`login.example.co.uk` → `example.co.uk`); hosts without one (IPs, localhost) map to themselves.
public func registrableDomain(_ urlOrHost: String) -> String {
	let host = WebURL(urlOrHost)?.hostname ?? urlOrHost.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
	return PublicSuffixList.shared.registrableDomain(host) ?? host
}

/// How `savedUrl` matches `pageUrl`, or nil. Only http(s) URLs ever match.
public func matchUrl(_ savedUrl: String, _ pageUrl: String) -> UrlMatch? {
	guard let saved = WebURL(savedUrl), let page = WebURL(pageUrl) else {
		return nil
	}
	let insecure = saved.scheme == "https" && page.scheme == "http"
	if saved.origin == page.origin || (insecure && saved.host == page.host) {
		return UrlMatch(kind: .origin, insecure: insecure)
	}
	if stripWww(saved.hostname) == stripWww(page.hostname) {
		return UrlMatch(kind: .host, insecure: insecure)
	}
	let domain = registrableDomain(page.hostname)
	// Hosts without a registrable domain (IP addresses, localhost) only match exactly.
	// Kept identical to core, including that a page on the bare registrable domain
	// never domain-matches (only origin/host do there).
	if domain != page.hostname && registrableDomain(saved.hostname) == domain {
		return UrlMatch(kind: .domain, insecure: insecure)
	}
	return nil
}

public struct LoginMatch<Entry: Sendable>: Sendable {
	public var match: UrlMatch
	public var entry: Entry
}

/// Logins whose URLs match the page, best match first, then by title.
public func matchLogins<Entry: Sendable>(_ entries: [Entry], pageUrl: String, item: (Entry) -> Item) -> [LoginMatch<Entry>] {
	var matches: [LoginMatch<Entry>] = []
	for entry in entries {
		let login = item(entry)
		guard login.type == .login else {
			continue
		}
		var best: UrlMatch?
		for url in login.urls {
			guard let m = matchUrl(url, pageUrl) else {
				continue
			}
			if let current = best {
				if m.kind < current.kind || (m.kind == current.kind && current.insecure && !m.insecure) {
					best = m
				}
			} else {
				best = m
			}
		}
		if let best {
			matches.append(LoginMatch(match: best, entry: entry))
		}
	}
	return matches.sorted { a, b in
		if a.match.kind != b.match.kind {
			return a.match.kind < b.match.kind
		}
		if a.match.insecure != b.match.insecure {
			return !a.match.insecure
		}
		return item(a.entry).title.compare(item(b.entry).title, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedAscending
	}
}
