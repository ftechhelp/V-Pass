import axios, { isAxiosError } from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'
import { ApiError, type Transport, type TransportRequest, VPassApi } from '@vpass/core'

/**
 * Web-app transport: @nextcloud/axios adds the session request token; the OCS
 * header lets Nextcloud treat this as an API call. Unwraps `{ ocs: { data } }`.
 */
const transport: Transport = {
	async request<T>(req: TransportRequest): Promise<T> {
		const url = generateOcsUrl(`apps/vpass/api/v1${req.path}`)
		try {
			const response = await axios.request({
				url,
				method: req.method,
				params: req.query,
				data: req.form ?? req.json,
				responseType: req.responseType === 'arraybuffer' ? 'arraybuffer' : 'json',
				headers: {
					'OCS-APIRequest': 'true',
					Accept: req.responseType === 'arraybuffer' ? 'application/octet-stream' : 'application/json',
				},
			})
			if (req.responseType === 'arraybuffer') {
				return response.data as T
			}
			return response.data.ocs.data as T
		} catch (e) {
			if (isAxiosError(e) && e.response) {
				const body = e.response.data as { ocs?: { meta?: { message?: string }, data?: { message?: string } } } | undefined
				const message = body?.ocs?.data?.message || body?.ocs?.meta?.message || e.message
				throw new ApiError(e.response.status, message, body?.ocs?.data)
			}
			throw e
		}
	},
}

export const api = new VPassApi(transport)
