import { describe, expect, it } from 'vitest'
import { getCodexServiceTierOptions } from './codexServiceTierOptions'

describe('getCodexServiceTierOptions', () => {
    it('returns default, fast, and flex in menu order', () => {
        expect(getCodexServiceTierOptions()).toEqual([
            { value: null, label: 'Default' },
            { value: 'fast', label: 'Fast' },
            { value: 'flex', label: 'Flex' },
        ])
    })
})
