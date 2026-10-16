import type { LoginItem } from '../model/items.ts'
import { type RangeFetcher, pwnedCount } from './hibp.ts'

export interface HealthEntry {
	id: string
	item: LoginItem
}

export interface HealthReport {
	/** Logins that have a password. */
	total: number
	weak: string[]
	/** Groups of item ids sharing the same password (each group has ≥ 2 ids). */
	reused: string[][]
	/** Password unchanged for longer than `oldAfterDays`. */
	old: string[]
	/** 0–100: share of passwords that are neither weak nor reused (nor breached, once known). */
	score: number
}

export interface HealthOptions {
	/** Returns a zxcvbn score 0–4. */
	strength: (password: string, userInputs: string[]) => number
	now?: Date
	oldAfterDays?: number
}

export function analyzePasswords(entries: HealthEntry[], opts: HealthOptions): HealthReport {
	const now = (opts.now ?? new Date()).getTime()
	const oldMs = (opts.oldAfterDays ?? 365) * 86_400_000
	const withPassword = entries.filter((e) => e.item.password)

	const weak: string[] = []
	const old: string[] = []
	const byPassword = new Map<string, string[]>()
	for (const { id, item } of withPassword) {
		if (opts.strength(item.password, [item.username, item.title]) < 3) {
			weak.push(id)
		}
		const changed = Date.parse(item.passwordChangedAt ?? item.createdAt)
		if (Number.isFinite(changed) && now - changed > oldMs) {
			old.push(id)
		}
		byPassword.set(item.password, [...(byPassword.get(item.password) ?? []), id])
	}
	const reused = [...byPassword.values()].filter((ids) => ids.length > 1)

	return {
		total: withPassword.length,
		weak,
		reused,
		old,
		score: healthScore(withPassword.length, [weak, reused.flat()]),
	}
}

export function healthScore(total: number, problems: string[][]): number {
	if (total === 0) {
		return 100
	}
	const bad = new Set(problems.flat())
	return Math.round(100 * (total - bad.size) / total)
}

/**
 * Check every distinct password against HIBP. Passwords are hashed locally and
 * each 5-char prefix is fetched once. Returns item id → breach count (> 0 only).
 */
export async function checkBreaches(
	entries: HealthEntry[],
	fetchRange: RangeFetcher,
	onProgress?: (done: number, total: number) => void,
	concurrency = 4,
): Promise<Map<string, number>> {
	const byPassword = new Map<string, string[]>()
	for (const { id, item } of entries) {
		if (item.password) {
			byPassword.set(item.password, [...(byPassword.get(item.password) ?? []), id])
		}
	}
	const passwords = [...byPassword.keys()]
	const result = new Map<string, number>()
	const rangeCache = new Map<string, Promise<string>>()
	const cachedFetch: RangeFetcher = (prefix) => {
		if (!rangeCache.has(prefix)) {
			rangeCache.set(prefix, fetchRange(prefix))
		}
		return rangeCache.get(prefix)!
	}
	let done = 0
	let next = 0
	const worker = async () => {
		while (next < passwords.length) {
			const password = passwords[next++]!
			const count = await pwnedCount(password, cachedFetch)
			if (count > 0) {
				for (const id of byPassword.get(password)!) {
					result.set(id, count)
				}
			}
			onProgress?.(++done, passwords.length)
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, passwords.length) }, worker))
	return result
}
