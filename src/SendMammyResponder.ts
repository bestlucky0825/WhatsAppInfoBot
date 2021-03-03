import type { WAMessage } from "@adiwajshing/baileys"
import type { AuthenticationController } from "@chatdaddy/authentication-utils"
import { LanguageProcessor, WAResponderParameters } from "./types"
import { onWAMessage } from "./WAResponder"
import got from "got"
import { URL } from "url"

// serverless function for interacting with SendMammy APIs

export type SendMammyResponderParameters = WAResponderParameters & {
	refreshToken: string
}

const { makeAuthenticationController } = require('@chatdaddy/authentication-utils') || {}
export const createSendMammyResponder = (processor: LanguageProcessor, metadata: SendMammyResponderParameters) => {
	if(!makeAuthenticationController) {
		throw new Error('Could not find @chatdaddy/authentication-utils')
	}
	const authController: AuthenticationController = makeAuthenticationController(
		metadata.refreshToken,
		process.env.AUTH_SERVICE_URL || 'https://api-auth.chatdaddy.tech'
	)
	const sendMammyUrl = new URL(process.env.SENDMAMMY_URL || 'https://api.sendmammy.com')
	return async (event: any) => {
		const authToken = event.headers['Authorization']?.replace('Bearer ', '')
		const user = await authController.authenticate(authToken)

		const sendMessage = async(jid: string, text: string, quoted?: WAMessage) => {
			const token = await authController.getToken(user.teamId)
			const timestamp = Math.floor(Date.now()/1000)
			const result = await got.post(
				new URL(`messages/${jid}`, sendMammyUrl),
				{
					body: JSON.stringify({
						text,
						scheduleAt: timestamp, // send message now
						quotedID: quoted?.key.id, // quote the message
						withTyping: true, // send with typing indicator
						randomizeMessage: false,
						tag: timestamp.toString() // ensures the message is only sent out once 
					}),
					headers: {
						'authorization': `Bearer ${token}`,
						'content-type': 'application/json'
					},
					retry: {
						limit: 10,
						statusCodes: [504, 503, 502, 408],
						errorCodes: [ 'ENOTFOUND', 'ETIMEDOUT' ],
						calculateDelay: () => 250
					},
					throwHttpErrors: false
				}
			)
			if(![200, 409].includes(result.statusCode)) {
				throw new Error(`error in pushing message: (${result.statusCode}) ${result.body}`)
			}
		}
		
		console.log('received web-hook for ' + user.teamId)

		const body = JSON.parse(event.body)

		console.log('event is ', body.event)

		if((body.event === 'chat-update' && body.data.hasNewMessage) ||
			body.event === 'messages-post-sleep') {
			await Promise.all(
				body.data.messages.map((message: WAMessage) => (
					onWAMessage(message, { metadata, processor, sendMessage })
				))
			)
			return {
				statusCode: 200,
				body: JSON.stringify({ success: true })
			}
		}
		return { statusCode: 204 }
	}
}