import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The Nextcloud account V-Pass talks to: an app password from Login Flow v2 that
/// only this client uses. It is revocable in Nextcloud → Settings → Security.
public struct Account: Codable, Sendable, Equatable {
	public var server: String
	public var loginName: String
	public var appPassword: String

	public init(server: String, loginName: String, appPassword: String) {
		self.server = server
		self.loginName = loginName
		self.appPassword = appPassword
	}
}

public struct LoginFlowError: Error, LocalizedError, Equatable {
	public let message: String

	public init(_ message: String) {
		self.message = message
	}

	public var errorDescription: String? { message }
}

/// A started Login Flow v2: show `loginURL` to the user, then `poll` until it returns an account.
public struct LoginFlowSession: Sendable, Equatable, Identifiable {
	public var id: String { token }
	public var server: String
	public var loginURL: URL
	public var endpoint: URL
	public var token: String
	/// Nextcloud expires login flow tokens after 20 minutes.
	public var expires: Date
}

/// Login Flow v2, ported from the plain-fetch parts of the extension's `background/account.ts`.
public struct LoginFlow: Sendable {
	private let client: HTTPClient
	/// Nextcloud names the app password after the User-Agent of the request that starts the flow.
	private let userAgent: String

	public init(client: HTTPClient = URLSessionHTTPClient(), userAgent: String = "V-Pass iPhone") {
		self.client = client
		self.userAgent = userAgent
	}

	/// "cloud.example.com", "https://cloud.example.com/index.php/apps/files" → "https://cloud.example.com"
	public static func normaliseServer(_ input: String) throws -> String {
		var value = input.trimmingCharacters(in: .whitespacesAndNewlines)
		if value.firstMatch(of: /^[hH][tT][tT][pP][sS]?:\/\//) == nil {
			value = "https://\(value)"
		}
		guard let components = URLComponents(string: value), let scheme = components.scheme?.lowercased(),
			let host = components.host?.lowercased(), !host.isEmpty else {
			throw LoginFlowError("That doesn't look like a server address")
		}
		let defaultPort = (scheme == "https" && components.port == 443) || (scheme == "http" && components.port == 80)
		let port = components.port.flatMap { defaultPort ? nil : ":\($0)" } ?? ""
		let path = components.path
			.replacing(/\/(index\.php|apps|login|settings|ocs)(\/.*)?$/, with: "")
			.replacing(/\/+$/, with: "")
		return "\(scheme)://\(host)\(port)\(path)"
	}

	public static func isAllowed(server: String) -> Bool {
		guard let url = URLComponents(string: server) else {
			return false
		}
		return url.scheme == "https" || url.host == "localhost" || url.host == "127.0.0.1"
	}

	public func start(serverInput: String, now: Date = Date()) async throws -> LoginFlowSession {
		let server = try Self.normaliseServer(serverInput)
		let host = URLComponents(string: server)?.host ?? server
		guard Self.isAllowed(server: server) else {
			throw LoginFlowError("Use an https:// address: V-Pass will not send your login over plain http")
		}
		var request = URLRequest(url: URL(string: "\(server)/index.php/login/v2")!)
		request.httpMethod = "POST"
		request.setValue("true", forHTTPHeaderField: "OCS-APIRequest")
		request.setValue("application/json", forHTTPHeaderField: "Accept")
		request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
		let body: Data
		let response: HTTPURLResponse
		do {
			(body, response) = try await client.send(request)
		} catch {
			throw LoginFlowError("Could not reach \(host). Check the address and your connection.")
		}
		guard (200..<300).contains(response.statusCode) else {
			throw LoginFlowError("\(host) did not accept the login request (HTTP \(response.statusCode)). Is this a Nextcloud server?")
		}
		let json = try? JSONValue.parse(body)
		guard let token = json?["poll"]?["token"]?.stringValue, let endpoint = json?["poll"]?["endpoint"]?.stringValue.flatMap(URL.init(string:)),
			let login = json?["login"]?.stringValue.flatMap(URL.init(string:)) else {
			throw LoginFlowError("\(host) does not look like a Nextcloud server")
		}
		return LoginFlowSession(server: server, loginURL: login, endpoint: endpoint, token: token, expires: now.addingTimeInterval(20 * 60))
	}

	/// Poll once. Returns nil while the flow is still waiting for the user (or the network is down).
	public func poll(_ flow: LoginFlowSession, now: Date = Date()) async throws -> Account? {
		guard now <= flow.expires else {
			throw LoginFlowError("The sign-in took too long. Start again.")
		}
		var request = URLRequest(url: flow.endpoint)
		request.httpMethod = "POST"
		request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
		request.setValue("application/json", forHTTPHeaderField: "Accept")
		request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
		var form = URLComponents()
		form.queryItems = [URLQueryItem(name: "token", value: flow.token)]
		request.httpBody = Data((form.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
		let body: Data
		let response: HTTPURLResponse
		do {
			(body, response) = try await client.send(request)
		} catch {
			return nil
		}
		if response.statusCode == 404 {
			return nil
		}
		guard (200..<300).contains(response.statusCode) else {
			throw LoginFlowError("Login flow failed with HTTP \(response.statusCode)")
		}
		let json = try? JSONValue.parse(body)
		guard let loginName = json?["loginName"]?.stringValue, let appPassword = json?["appPassword"]?.stringValue else {
			throw LoginFlowError("The server sent an unexpected answer")
		}
		let server = (json?["server"]?.stringValue ?? "").replacing(/\/+$/, with: "")
		return Account(server: server.isEmpty ? flow.server : server, loginName: loginName, appPassword: appPassword)
	}

	/// Revoke the app password on the server (best effort: offline, it stays valid
	/// until revoked in Nextcloud's security settings).
	public func revoke(_ account: Account) async {
		guard let url = URL(string: "\(account.server)/ocs/v2.php/core/apppassword") else {
			return
		}
		var request = URLRequest(url: url)
		request.httpMethod = "DELETE"
		request.setValue("true", forHTTPHeaderField: "OCS-APIRequest")
		request.setValue(basicAuthorization(user: account.loginName, password: account.appPassword), forHTTPHeaderField: "Authorization")
		_ = try? await client.send(request)
	}
}
