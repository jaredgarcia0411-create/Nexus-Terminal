# Subagent: Codebase Analyzer

## Task
Research how "{{TOPIC}}" is used in the current codebase.

## Codebase Path
{{WORKSPACE_ROOT}}

## Tasks
1. Search for any files using this technology/pattern
2. Identify how it's actually implemented here
3. Note any custom wrappers or abstractions
4. Identify relevant files to reference

## Output Format
Return your findings in this structure:

```
## Files Using This Pattern
1. `[file path]` - [How it's used, 1-2 sentences]
2. ...

## Implementation Examples

### From: `[most relevant file]`
```[language]
[relevant code snippet]
```
**Notes**: [Any customizations or patterns specific to this codebase]

### From: `[another file]`
```[language]
[relevant code snippet]
```

## Abstractions/Wrappers Found
- [Name]: [Location] - [What it does, why it exists]

## Integration Points
- Where this connects to other parts of the system

## Patterns Specific to This Codebase
- [Any unique approaches taken here]

## Files to Reference
- [List of paths that would be most educational to look at]
```

If the topic is not found in the codebase, state that clearly and note what related patterns are used instead.
