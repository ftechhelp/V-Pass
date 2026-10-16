import { type DecryptedItem, type Item, newItem } from '@vpass/core'
import { describe, expect, it } from 'vitest'
import { cardPayload, identityPayload, pageUrlOf } from '../src/background/autofill.ts'
import { senderKind } from '../src/background/router.ts'
import { classifySubmission } from '../src/background/save.ts'

const entry = (id: string, item: Item): DecryptedItem => ({ id, item, key: new Uint8Array(32), revision: 1, createdAt: 0, updatedAt: 0, deletedAt: null })
const login = (id: string, username: string, password: string) => entry(id, newItem('login', { title: id, username, password, urls: ['https://example.com'] }))

describe('save prompts', () => {
	const vault = [login('a', 'alice@example.com', 'old-pass'), login('b', 'bob', 'bob-pass')]

	it('offers to save unknown accounts', () => {
		expect(classifySubmission(vault, 'carol', 'pw', null)).toEqual({ kind: 'new', existing: null })
	})

	it('offers to update a changed password, matching usernames case-insensitively', () => {
		expect(classifySubmission(vault, 'Alice@Example.com', 'new-pass', null)).toMatchObject({ kind: 'update', existing: { id: 'a' } })
	})

	it('stays quiet when the vault already has these credentials', () => {
		expect(classifySubmission(vault, 'alice@example.com', 'old-pass', null)).toBeNull()
		expect(classifySubmission(vault, 'alice@example.com', '', null)).toBeNull()
	})

	it('identifies the login on change-password forms by its current password', () => {
		expect(classifySubmission(vault, '', 'bob-pass', 'fresh')).toMatchObject({ kind: 'update', existing: { id: 'b' } })
	})

	it('uses the only login for a password-only step', () => {
		expect(classifySubmission([vault[0]!], '', 'step-two', null)).toMatchObject({ kind: 'update', existing: { id: 'a' } })
		expect(classifySubmission(vault, '', 'step-two', null)).toEqual({ kind: 'new', existing: null })
	})
})

describe('fill payloads', () => {
	it('formats cards and identities as autocomplete tokens', () => {
		expect(cardPayload(newItem('card', { cardholderName: 'A', number: '4111 1111 1111 1111', expMonth: '7', expYear: '2029', cvc: '123' }))).toEqual({
			'cc-name': 'A', 'cc-number': '4111111111111111', 'cc-exp-month': '07', 'cc-exp-year': '2029', 'cc-exp': '07/29', 'cc-csc': '123', 'cc-type': 'visa',
		})
		const id = identityPayload(newItem('identity', { firstName: 'Alice', lastName: 'Example', address1: '1 Main St', address2: 'Apt 2', email: '' }))
		expect(id).toMatchObject({ 'name': 'Alice Example', 'street-address': '1 Main St\nApt 2' })
		expect(id).not.toHaveProperty('email')
	})
})

describe('message senders', () => {
	const ext = 'chrome-extension://vpass-test'
	it('tells extension pages, in-page iframes and content scripts apart', () => {
		expect(senderKind({ id: 'vpass-test', url: `${ext}/popup/index.html` })).toBe('page')
		expect(senderKind({ id: 'vpass-test', url: `${ext}/prompt/index.html#x`, tab: { id: 1 } as chrome.tabs.Tab })).toBe('page')
		expect(senderKind({ id: 'vpass-test', url: `${ext}/inline-menu/index.html#t`, tab: { id: 1 } as chrome.tabs.Tab, frameId: 3 })).toBe('frame-ui')
		expect(senderKind({ id: 'vpass-test', url: 'https://example.com/login', tab: { id: 1 } as chrome.tabs.Tab, frameId: 0 })).toBe('content')
	})

	it('rejects other extensions and unknown extension pages', () => {
		expect(senderKind({ id: 'someone-else', url: `${ext}/popup/index.html` })).toBeNull()
		expect(senderKind({ id: 'vpass-test', url: `${ext}/offscreen/index.html` })).toBeNull()
		expect(senderKind({ id: 'vpass-test', url: 'https://example.com/' })).toBeNull()
	})

	it('takes the page URL from the browser, falling back to the origin for about:blank frames', () => {
		expect(pageUrlOf({ url: 'https://example.com/login', origin: 'https://example.com' })).toBe('https://example.com/login')
		expect(pageUrlOf({ url: 'about:blank', origin: 'https://example.com' })).toBe('https://example.com')
		expect(pageUrlOf({ url: 'about:blank', origin: 'null' })).toBeNull()
		expect(pageUrlOf({ url: 'chrome://settings' })).toBeNull()
	})
})
