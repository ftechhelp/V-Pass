// swift-tools-version: 6.0
import PackageDescription

// Platform-neutral V-Pass logic for the iOS app and its AutoFill extension:
// a byte-compatible port of @vpass/core. It also builds and tests on Linux
// (`make test-ios-kit`), so the crypto and API code is checked without a Mac.
let package = Package(
	name: "VPassKit",
	platforms: [.iOS(.v18), .macOS(.v15)],
	products: [
		.library(name: "VPassKit", targets: ["VPassKit"]),
	],
	dependencies: [
		// libsodium: the binary xcframework on Apple platforms, the system library (pkg-config) on Linux.
		.package(url: "https://github.com/jedisct1/swift-sodium.git", from: "0.11.0"),
		// CryptoKit's API on every platform (HMAC, SHA-256, P-256), plus RSA in CryptoExtras.
		.package(url: "https://github.com/apple/swift-crypto.git", from: "4.0.0"),
	],
	targets: [
		.target(
			name: "VPassKit",
			dependencies: [
				.product(name: "Clibsodium", package: "swift-sodium"),
				.product(name: "Crypto", package: "swift-crypto"),
				.product(name: "CryptoExtras", package: "swift-crypto"),
			],
			resources: [
				.copy("Resources/eff-wordlist.txt"),
				.copy("Resources/public_suffix_list.dat"),
			]
		),
		.testTarget(
			name: "VPassKitTests",
			dependencies: ["VPassKit"],
			resources: [.copy("Fixtures")]
		),
	]
)
