import Papa from 'papaparse'
import { NORDPASS_COLUMNS } from '../import/nordpass.ts'
import { type Item, fullName } from '../model/items.ts'

/**
 * Plain-text CSV in NordPass's column layout, so the export can be imported into
 * NordPass, Bitwarden, Proton Pass and others. UNENCRYPTED — the UI warns before use.
 * Passkeys cannot be represented in CSV and are omitted.
 */
export function exportNordPassCsv(items: Item[], folderName: (folderId: string | null) => string): string {
	const rows = items.map((item) => {
		const row: Record<string, string> = Object.fromEntries(NORDPASS_COLUMNS.map((c) => [c, '']))
		row.name = item.title
		row.note = item.notes
		row.folder = folderName(item.folderId)
		const customFields = item.customFields.map((f) => ({ label: f.label, type: f.type, value: f.value }))
		switch (item.type) {
		case 'login':
			row.type = 'password'
			row.url = item.urls[0] ?? ''
			row.additional_urls = item.urls.length > 1 ? JSON.stringify(item.urls.slice(1)) : ''
			row.username = item.username
			row.password = item.password
			if (item.totp) {
				customFields.push({ label: 'totp', type: 'hidden', value: item.totp })
			}
			break
		case 'note':
			row.type = 'note'
			break
		case 'card':
			row.type = 'credit_card'
			row.cardholdername = item.cardholderName
			row.cardnumber = item.number
			row.cvc = item.cvc
			row.pin = item.pin
			row.expirydate = item.expMonth && item.expYear ? `${item.expMonth}/${item.expYear.slice(-2)}` : ''
			row.zipcode = item.zip
			break
		case 'identity':
			row.type = 'identity'
			row.full_name = fullName(item)
			row.email = item.email
			row.phone_number = item.phone
			row.address1 = item.address1
			row.address2 = item.address2
			row.city = item.city
			row.state = item.state
			row.zipcode = item.zip
			row.country = item.country
			break
		}
		row.custom_fields = customFields.length ? JSON.stringify(customFields) : ''
		return row
	})
	return Papa.unparse({ fields: [...NORDPASS_COLUMNS], data: rows.map((r) => NORDPASS_COLUMNS.map((c) => r[c] ?? '')) })
}
