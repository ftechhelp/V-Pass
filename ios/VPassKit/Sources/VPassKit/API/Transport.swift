import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum HTTPMethod: String, Sendable {
	case get = "GET", post = "POST", put = "PUT", delete = "DELETE"
}

public struct TransportRequest: Sendable {
	public var method: HTTPMethod
	/// Path below the API base, e.g. `/items/abc`.
	public var path: String
	public var query: [String: String]
	public var json: JSONValue?
	public var binaryResponse: Bool

	public init(method: HTTPMethod, path: String, query: [String: String] = [:], json: JSONValue? = nil, binaryResponse: Bool = false) {
		self.method = method
		self.path = path
		self.query = query
		self.json = json
		self.binaryResponse = binaryResponse
	}
}

/// Mirrors `Transport` in `api/client.ts`: performs the request and returns the
/// unwrapped OCS `data` (as JSON), or the raw bytes for binary responses.
/// Throws `ApiError` for non-2xx responses.
public protocol Transport: Sendable {
	func request(_ req: TransportRequest) async throws -> Data
}

public struct ApiError: Error, LocalizedError {
	public let status: Int
	public let message: String
	public let data: JSONValue?

	public init(status: Int, message: String, data: JSONValue? = nil) {
		self.status = status
		self.message = message
		self.data = data
	}

	public var errorDescription: String? { message }
}

/// 409: someone else changed the object first. `current` is the server's version.
public struct ConflictError<T: Sendable>: Error, LocalizedError {
	public let current: T?

	public var errorDescription: String? { "This entry was changed on another device" }
}

/// HTTP Basic auth with a Login Flow v2 app password, as `createFetchTransport` in core.
public struct OCSTransport: Transport {
	public let baseUrl: String
	private let authorization: String
	private let client: HTTPClient

	public init(account: Account, client: HTTPClient = URLSessionHTTPClient()) {
		baseUrl = account.server.replacing(/\/+$/, with: "")
		authorization = basicAuthorization(user: account.loginName, password: account.appPassword)
		self.client = client
	}

	public func request(_ req: TransportRequest) async throws -> Data {
		guard var components = URLComponents(string: "\(baseUrl)/ocs/v2.php/apps/vpass/api/v1\(req.path)") else {
			throw ApiError(status: 0, message: "Invalid server address")
		}
		if !req.query.isEmpty {
			components.queryItems = req.query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
		}
		var request = URLRequest(url: components.url!)
		request.httpMethod = req.method.rawValue
		request.setValue("true", forHTTPHeaderField: "OCS-APIRequest")
		request.setValue(req.binaryResponse ? "application/octet-stream" : "application/json", forHTTPHeaderField: "Accept")
		request.setValue(authorization, forHTTPHeaderField: "Authorization")
		if let json = req.json {
			request.httpBody = json.serializedData()
			request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		}

		let (body, response) = try await client.send(request)
		let ok = (200..<300).contains(response.statusCode)
		if ok && req.binaryResponse {
			return body
		}
		let parsed = try? JSONValue.parse(body)
		let data = parsed?["ocs"]?["data"]
		if !ok {
			let message = data?["message"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
				?? parsed?["ocs"]?["meta"]?["message"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
				?? "HTTP \(response.statusCode)"
			throw ApiError(status: response.statusCode, message: message, data: data)
		}
		return (data ?? .null).serializedData()
	}
}
