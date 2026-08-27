import sha224 from 'crypto-js/sha224'
import CryptoJSHex from 'crypto-js/enc-hex'
import { v5 as uuidv5 } from "uuid"
import { Env, Config } from "./interfaces"
import { providersUri, proxiesUri } from "./variables"

export function GetMultipleRandomElements(arr: Array<any>, num: number): Array<any> {
	let shuffled = arr.sort(() => 0.5 - Math.random())
	return shuffled.slice(0, num)
}

export function IsIp(str: string): boolean {
	try {
		if (str == "" || str == undefined) return false
		if (!/^(\d{1,2}|1\d\d|2[0-4]\d|25[0-5])(\.(\d{1,2}|1\d\d|2[0-4]\d|25[0-5])){2}\.(\d{1,2}|1\d\d|2[0-4]\d|25[0-4])$/.test(str)) {
			return false
		}
		let ls = str.split('.')
		if (ls == null || ls.length != 4 || ls[3] == "0" || parseInt(ls[3]) === 0) {
			return false
		}
		return true
	} catch (e) { }
	return false
}

export function IsValidUUID(uuid: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)
}

export function GetVlessConfig(no: number, uuid: string, sni: string, address: string, port: number) {
	if (address.toLowerCase() == sni.toLowerCase()) {
    address = sni
  }
  return {
		remarks: `${no}-vless-worker-${address}`,
		configType: "vless",
		security: "tls",
		tls: "tls",
		network: "ws",
		port: port,
		sni: sni,
		uuid: uuid,
		host: sni,
		path: "vless-ws/?ed=2048",
		address: address,
	} as Config
}

export function GetTrojanConfig(no: number, sha224Password: string, sni: string, address: string, port: number) {
	if (address.toLowerCase() == sni.toLowerCase()) {
    address = sni
  }
  return {
		remarks: `${no}-trojan-worker-${address}`,
		configType: "trojan",
		security: "tls",
		tls: "tls",
		network: "ws",
		port: port,
		sni: sni,
		password: sha224Password,
		host: sni,
		path: "trojan-ws/?ed=2048",
		address: address,
	} as Config
}

export function IsBase64(str: string): boolean {
	return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/.test(str)
}

export function RemoveDuplicateConfigs(configList: Array<Config>): Array<Config> {
  const seen: { [key: string]: boolean } = {}

  return configList.filter((conf: Config) => {
    const key = conf.remarks + conf.port + conf.address + conf.uuid
    if (!seen[key]) {
      seen[key] = true
      return true
    }
    return false
  })
}

export function AddNumberToConfigs(configList: Array<Config>, start: number): Array<Config> {
  const seen: { [key: string]: boolean } = {}

  return configList.map((conf: Config, index: number) => {
    conf.remarks = (index + start) + "-" + conf.remarks 
    return conf
  })
}

export function GenerateToken(length: number = 32): string {
  // Was using Math.random(), which is not a cryptographically secure PRNG — its output
  // is predictable enough in principle to be a real risk for a bearer token that grants
  // full admin-panel access. crypto.getRandomValues() is the standard Web Crypto API
  // and is available in the Workers runtime.
  const buffer: Uint8Array = new Uint8Array(length)
  crypto.getRandomValues(buffer)
  return Array.from(buffer).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function ConstantTimeEqual(a: string, b: string): boolean {
  // Plain === / != on secrets can leak timing information about how many leading
  // characters matched. This compares in time proportional to the longer string,
  // regardless of where the first mismatch occurs.
  const maxLength = Math.max(a.length, b.length)
  let mismatch = a.length === b.length ? 0 : 1
  for (let i = 0; i < maxLength; i++) {
    const charA = a.charCodeAt(i) || 0
    const charB = b.charCodeAt(i) || 0
    mismatch |= charA ^ charB
  }
  return mismatch === 0
}

export function Delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function MuddleDomain(hostname: string): string {
  const parts: string[] = hostname.split(".")
  const subdomain: string = parts.slice(0, parts.length -2).join(".")
  const domain: string = parts.slice(-2).join(".")

  const muddledDomain: string = domain.split("").map(
	  char => Math.random() < 0.5 ? char.toLowerCase() : char.toUpperCase()
  ).join("")
  
  return subdomain + "." + muddledDomain
}

export async function getDefaultProviders(): Promise<Array<string>> {
	return fetch(providersUri).then(r => r.text()).then(t => t.trim().split("\n"))
}

export async function getDefaultProxies(): Promise<Array<string>> {
	return fetch(proxiesUri).then(r => r.text()).then(t => t.trim().split("\n").filter(t => t.trim().length > 0))
}

export async function getProxies(env: Env): Promise<Array<string>> {
	let proxyIPList: Array<string> = []
    try {
      proxyIPList = (await env.settings.get("Proxies"))?.trim().split("\n").filter(t => t.trim().length > 0) || []
    } catch (e) {
      // Ignore
    }
    if (!proxyIPList.length) {
      proxyIPList = await getDefaultProxies()
    }

	return proxyIPList
}

export function getUUID(sni: string) : string {
  return uuidv5(sni.toLowerCase(), "ebc4a168-a6fe-47ce-bc25-6183c6212dcc") as string
}

export function getSHA224Password(sni: string) : string {
  return sha224(sni.toLowerCase()).toString(CryptoJSHex)
}
