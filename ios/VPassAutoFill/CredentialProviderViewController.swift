import AuthenticationServices
import SwiftUI
import VPassKit

/// V-Pass's AutoFill extension: passwords, one-time codes and passkeys for Safari
/// and apps. iOS calls one of the entry points below; the SwiftUI sheet then
/// unlocks the vault (Face ID or the master password) and completes the request.
final class CredentialProviderViewController: ASCredentialProviderViewController {
	private lazy var model = AutoFillModel(provider: self)

	override func viewDidLoad() {
		super.viewDidLoad()
		let host = UIHostingController(rootView: AutoFillRootView().environment(model))
		addChild(host)
		host.view.translatesAutoresizingMaskIntoConstraints = false
		view.addSubview(host.view)
		NSLayoutConstraint.activate([
			host.view.topAnchor.constraint(equalTo: view.topAnchor),
			host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
			host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
			host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
		])
		host.didMove(toParent: self)
	}

	/* ----- entry points ----- */

	override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
		model.begin(.list(serviceIdentifiers.map(\.identifier), passkeys: nil))
	}

	override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier], requestParameters: ASPasskeyCredentialRequestParameters) {
		model.begin(.list(serviceIdentifiers.map(\.identifier), passkeys: requestParameters))
	}

	override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
		model.begin(.oneTimeCodes(serviceIdentifiers.map(\.identifier)))
	}

	/// The vault key sits behind Face ID, so every request needs the sheet.
	override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
		extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
	}

	override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
		model.begin(.provide(credentialRequest))
	}

	override func prepareInterface(forPasskeyRegistration registrationRequest: any ASCredentialRequest) {
		guard let request = registrationRequest as? ASPasskeyCredentialRequest else {
			extensionContext.cancelRequest(withError: ASExtensionError(.failed))
			return
		}
		model.begin(.register(request))
	}

	override func prepareInterfaceForExtensionConfiguration() {
		model.begin(.configure)
	}
}
