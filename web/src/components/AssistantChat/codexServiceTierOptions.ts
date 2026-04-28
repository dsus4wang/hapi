export type CodexServiceTier = 'fast' | 'flex'

export type CodexServiceTierOption = {
    value: CodexServiceTier | null
    label: string
}

export function getCodexServiceTierOptions(): CodexServiceTierOption[] {
    return [
        { value: null, label: 'Default' },
        { value: 'fast', label: 'Fast' },
        { value: 'flex', label: 'Flex' },
    ]
}
