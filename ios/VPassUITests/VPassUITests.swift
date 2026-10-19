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
}
