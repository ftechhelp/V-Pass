import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The one thing V-Pass needs from the network. URLSession in the app; stubs in tests.
public protocol HTTPClient: Sendable {
	func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// URLSession without cookies or caching: a Nextcloud browser session must never
/// mix with the app password, and ciphertext has no business in an HTTP cache.
public final class URLSessionHTTPClient: HTTPClient {
	private let session: URLSession

	public init(timeout: TimeInterval = 30) {
		let config = URLSessionConfiguration.ephemeral
		config.httpCookieStorage = nil
		config.httpShouldSetCookies = false
		config.urlCache = nil
		config.requestCachePolicy = .reloadIgnoringLocalCacheData
		config.timeoutIntervalForRequest = timeout
		session = URLSession(configuration: config)
	}

	public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
		try await withCheckedThrowingContinuation { continuation in
			let task = session.dataTask(with: request) { data, response, error in
				if let error {
					continuation.resume(throwing: error)
				} else if let http = response as? HTTPURLResponse {
					continuation.resume(returning: (data ?? Data(), http))
				} else {
					continuation.resume(throwing: URLError(.badServerResponse))
				}
			}
			task.resume()
		}
	}
}

/// `Basic base64(user:password)` with UTF-8, like `btoa(unescape(encodeURIComponent(...)))`.
public func basicAuthorization(user: String, password: String) -> String {
	"Basic \(Data("\(user):\(password)".utf8).base64EncodedString())"
}
