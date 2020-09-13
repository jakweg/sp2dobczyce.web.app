import { default as fetch } from 'node-fetch'
import { parse as parseHTML } from 'node-html-parser'

const fullLineRegex = /^([0-9])\)\s*([a-z0-9]+)\s*-\s*([_\p{L} ]+)\s*-\s*([\p{L}\- .]+).*/iu
const withoutClassRegex = /^([0-9])\)\s*([_\p{L} ]+)\s*-\s*([\p{L}\- ]+).*/iu
const ignoreLineRegex = /wycieczka|rekolekcje|wyjazd|pielgrzymka/iu
const affectsExtractRegex = /(\d\w)|ks\.(\p{L}+).*|([\p{L}-]+).*/iu

const tryToParseDate = (line: string) => {
	const l = (line.includes('r.')) ? line.substring(0, line.indexOf('r.')).trim() : line
	const millis = Date.parse(l)
	return !!millis ? new Date(millis) : null
}

// interface Substitute {
// 	lineNumber: number
// 	lessonNumber: number
// 	subjectName: string
// 	teacherName: string
// 	className?: string
// }

interface ComputedLine {
	content: string
	affects?: string[]
}

export interface SubstituteSection {
	date: string | null
	header: string | null
	textRaw: string
	// entries: Substitute[]
	lines: ComputedLine[]
}

const combineSections = (one: SubstituteSection, two: SubstituteSection): SubstituteSection => {
	if (one.date !== two.date) throw new Error('To add two sections they must have the same date')
	// const linesCount = one.text.split('\n').length + 1
	const textCombined = one.textRaw + '\n' + two.textRaw
	// const entries = [...one.entries, ...two.entries.map(e => ({
	// 	...e,
	// 	lineNumber: e.lineNumber + linesCount,
	// }))]
	return {
		header: one.header || two.header || null,
		textRaw: textCombined,
		date: one.date,
		// entries,
		lines: [...one.lines, ...two.lines],
	}
}

export const downloadAndParseSubstitutes = async (lastContent: string | undefined) => {
	const response = await fetch('http://sp2dobczyce.pl/zastepstwa/index.html')
	if (!response.ok) {
		throw new Error('Response not ok, status: ' + response.status + ' ' + response.statusText)
	}

	const htmlContent = await response.text()
	if (lastContent && lastContent === htmlContent) return null

	const dom = parseHTML(htmlContent)
	const sections = dom
		.querySelectorAll('div.table')
		.map(e => e.structuredText.trim())
		.filter(e => !!e)
		.map(section => {
			// const substitutes: Substitute[] = []
			const lines = section.split('\n')
			if (!lines[0]) return null
			const date = tryToParseDate(lines[0])
			let header = null

			if (!date) {
				header = lines[0]
			}

			let computedLines: ComputedLine[] | null = []

			if (date) {
				for (let i = 2; i < lines.length; i++) {
					const line = lines[i].trim()
					if (!line) continue
					if (ignoreLineRegex.test(line)) continue

					const computed: ComputedLine = {
						content: line,
					}
					let match = fullLineRegex.exec(line)
					if (match) {
						// substitutes.push({
						// 	lineNumber: i,
						// 	lessonNumber: +match[1].trim(),
						// 	className: match[2].trim(),
						// 	subjectName: match[3].trim(),
						// 	teacherName: match[4].trim(),
						// })
						computed.affects = [match[2], match[4]]
					} else {
						match = withoutClassRegex.exec(line)
						if (match) {
							// substitutes.push({
							// 	lineNumber: i,
							// 	lessonNumber: +match[1].trim(),
							// 	subjectName: match[2].trim(),
							// 	teacherName: match[3].trim(),
							// })
							computed.affects = [match[3]]
						}
					}


					if (computed.affects)
						computed.affects = computed.affects.map(value => {
							const results = affectsExtractRegex.exec(value)
							return (results ? results[1] || results[2] || results[3] || value : value).toLowerCase()
						})


					computedLines.push(computed)
				}
			}

			if (!computedLines.find(e => e.affects))
				computedLines = null // remove computed lines if not affect anything

			return <SubstituteSection>{
				header: header,
				// entries: substitutes,
				date: date?.toISOString()?.substr(0, 10) || null,
				textRaw: section,
				lines: computedLines,
			}
		})

	const grouped = new Map<string, SubstituteSection[]>()
	const withoutDate: SubstituteSection[] = []
	for (const s of sections) {
		if (!s) continue
		const date = s.date
		if (date) {
			const list = grouped.get(date)
			if (list)
				list.push(s)
			else
				grouped.set(date, [s])
		} else withoutDate.push(s)
	}

	const combined = Array
		.from(grouped.values())
		.map(sections2 => {
			let sum = sections2[0]
			for (let i = 1; i < sections2.length; i++) {
				sum = combineSections(sum, sections2[i])
			}
			return sum
		})

	return {
		htmlContent,
		sections: [...combined, ...withoutDate]
	}
}

export interface AddedLineEntry {
	content: string,
	affects: string[],
	date: string
}
export const compareSnapshots = (current: SubstituteSection[], last: SubstituteSection[]): AddedLineEntry[] => {
	const addedLines: AddedLineEntry[] = []

	for (const section of current) {
		const date = section.date
		if (!date) continue

		const lastSection = last.find(e => e.date === section.date)
		if (lastSection) {
			const equalSections = lastSection.textRaw === section.textRaw
			if (!equalSections) {
				for (let i = section.lines.length - 1; i >= 0; i--) {
					const {content, affects} = section.lines[i]
					if (!affects) continue
					const lastLine = lastSection.lines.find(e => e.content === content)

					if (!lastLine) {
						addedLines.push({
							affects: affects,
							content: content,
							date,
						})
					}
				}
			}

		}
	}

	return addedLines
}

