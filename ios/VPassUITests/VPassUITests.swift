import XCTest

/// Smoke tests on the simulator against the in-memory demo vault (`-UITestStub`):
/// no network, no Keychain, nothing persisted.
final class VPassUITests: XCTestCase {
	private let masterPassword = "demo master password"

	override func setUp() {
		continueAfterFailure = false
	}

	private func launch() -> XCUIApplication {
		let app = XCUIApplication()
		app.launchArguments = ["-UITestStub"]
		app.launch()
		return app
	}

	private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
		app.descendants(matching: .any).matching(identifier: identifier).firstMatch
	}

	private func unlock(_ app: XCUIApplication) {
		let field = app.secureTextFields["master-password"]
		XCTAssertTrue(field.waitForExistence(timeout: 60))
		field.tap()
		field.typeText(masterPassword + "\n")
		XCTAssertTrue(element(app, "item-GitHub").waitForExistence(timeout: 60))
	}

	func testWrongPasswordThenUnlock() {
		let app = launch()
		let field = app.secureTextFields["master-password"]
		XCTAssertTrue(field.waitForExistence(timeout: 60))
		field.tap()
		field.typeText("not the password\n")
		XCTAssertTrue(element(app, "unlock-error").waitForExistence(timeout: 30))
		unlock(app)
		element(app, "lock").tap()
		XCTAssertTrue(app.secureTextFields["master-password"].waitForExistence(timeout: 10))
	}

	func testBrowseCopyAndEdit() {
		let app = launch()
		unlock(app)
		element(app, "item-GitHub").tap()

		let username = element(app, "value-Username")
		XCTAssertTrue(username.waitForExistence(timeout: 10))
		XCTAssertEqual(username.label, "octocat")
		XCTAssertTrue(element(app, "totp-code").exists)

		element(app, "copy-Password").tap()
		XCTAssertTrue(element(app, "banner").waitForExistence(timeout: 5))

		element(app, "edit").tap()
		let usernameField = element(app, "edit-username")
		XCTAssertTrue(usernameField.waitForExistence(timeout: 10))
		usernameField.tap()
		usernameField.typeText("-edited")
		element(app, "save").tap()
		XCTAssertTrue(app.staticTexts["octocat-edited"].waitForExistence(timeout: 30))
	}

	func testCreateLoginWithGeneratedPassword() {
		let app = launch()
		unlock(app)
		element(app, "new-item").tap()
		app.buttons["Login"].tap()

		let title = element(app, "edit-title")
		XCTAssertTrue(title.waitForExistence(timeout: 10))
		title.tap()
		title.typeText("Made in UI test")
		element(app, "generate").tap()
		XCTAssertTrue(element(app, "generated").waitForExistence(timeout: 10))
		element(app, "use-password").tap()
		element(app, "save").tap()
		XCTAssertTrue(element(app, "value-Password").waitForExistence(timeout: 30))
	}

	/// The simulator has no camera: the scanner's "Simulate scan" returns DemoVault.setupQRCode.
	func testScanQrCodeSetsUpOneTimeCodes() {
		let app = launch()
		unlock(app)
		element(app, "new-item").tap()
		app.buttons["Login"].tap()

		let scan = element(app, "scan-qr")
		if !scan.waitForExistence(timeout: 10) {
			app.swipeUp()
		}
		XCTAssertTrue(scan.waitForExistence(timeout: 5))
		scan.tap()
		let simulate = element(app, "simulate-scan")
		XCTAssertTrue(simulate.waitForExistence(timeout: 10))
		simulate.tap()

		// The QR code's issuer and account name the new login.
		XCTAssertTrue(element(app, "totp-code").waitForExistence(timeout: 10))
		XCTAssertEqual(element(app, "edit-title").value as? String, "Example")
		XCTAssertEqual(element(app, "edit-username").value as? String, "alice@example.com")
		element(app, "save").tap()
		XCTAssertTrue(element(app, "value-Username").waitForExistence(timeout: 30))
		XCTAssertTrue(element(app, "totp-code").exists)
	}

	/// "Simulate scan" adds DemoVault.googleAuthenticatorExport: GitHub's code (already
	/// in the vault), one for the Bank login and one that becomes a new login.
	func testImportFromGoogleAuthenticator() {
		let app = launch()
		unlock(app)
		element(app, "settings").tap()
		let open = element(app, "import-codes")
		XCTAssertTrue(open.waitForExistence(timeout: 10))
		open.tap()

		let simulate = element(app, "simulate-export-scan")
		if !simulate.waitForExistence(timeout: 10) {
			app.swipeUp()
		}
		XCTAssertTrue(simulate.waitForExistence(timeout: 5))
		simulate.tap()
		XCTAssertTrue(element(app, "otp-found").label.hasPrefix("3 codes found"))
		element(app, "otp-review").tap()

		let bank = element(app, "otp-row-Bank")
		XCTAssertTrue(bank.waitForExistence(timeout: 30))
		XCTAssertTrue(bank.label.contains("Goes into Bank (me@example.com)"), bank.label)
		XCTAssertTrue(element(app, "otp-row-GitHub").label.contains("Already in GitHub (octocat)"))
		XCTAssertTrue(element(app, "otp-row-Example").label.contains("New login"))
		element(app, "otp-confirm").tap()
		XCTAssertTrue(element(app, "otp-done").waitForExistence(timeout: 30))
		XCTAssertEqual(element(app, "otp-done").label, "2 codes were imported")
		element(app, "otp-close").tap()
		element(app, "settings-done").tap()

		element(app, "item-Bank").tap()
		XCTAssertTrue(element(app, "totp-code").waitForExistence(timeout: 10))
		app.navigationBars.buttons.firstMatch.tap()
		XCTAssertTrue(element(app, "item-Example").waitForExistence(timeout: 10))
	}
}
