/*
 * Tests for OSC command parsing and notifications.
 */
import { describe, test, expect, vi } from 'vitest'
import { createCommandParser } from '../../src/terminal/command-parser'

describe('Command Parser', () => {
  test('parses OSC 9 notifications with title and body', () => {
    const onCommand = vi.fn()
    const onNotification = vi.fn()
    const parser = createCommandParser({ onCommand, onNotification })

    parser.processData('\x1b]9;System Alert;Process completed.\x07')

    expect(onCommand).not.toHaveBeenCalled()
    expect(onNotification).toHaveBeenCalledTimes(1)
    expect(onNotification).toHaveBeenCalledWith({
      title: 'System Alert',
      body: 'Process completed.',
      source: 'osc9',
    })
  })

  test('parses OSC 9 notifications with body only', () => {
    const onCommand = vi.fn()
    const onNotification = vi.fn()
    const parser = createCommandParser({ onCommand, onNotification })

    parser.processData('\x1b]9;Process completed.\x07')

    expect(onNotification).toHaveBeenCalledWith({
      title: '',
      body: 'Process completed.',
      source: 'osc9',
    })
  })

  test('parses OSC 777 notify payloads', () => {
    const onCommand = vi.fn()
    const onNotification = vi.fn()
    const parser = createCommandParser({ onCommand, onNotification })

    parser.processData('\x1b]777;notify;Task;Done\x07')

    expect(onNotification).toHaveBeenCalledWith({
      title: 'Task',
      body: 'Done',
      source: 'osc777',
    })
  })

  test('does not emit notification for openmux command', () => {
    const onCommand = vi.fn()
    const onNotification = vi.fn()
    const parser = createCommandParser({ onCommand, onNotification })

    parser.processData('\x1b]777;openmux;cmd=ls\x07')

    expect(onCommand).toHaveBeenCalledTimes(1)
    expect(onNotification).not.toHaveBeenCalled()
  })

  test('handles chunked OSC 9 sequences', () => {
    const onCommand = vi.fn()
    const onNotification = vi.fn()
    const parser = createCommandParser({ onCommand, onNotification })

    parser.processData('\x1b]9;Chunk')
    parser.processData('ed;Notice\x07')

    expect(onNotification).toHaveBeenCalledWith({
      title: 'Chunked',
      body: 'Notice',
      source: 'osc9',
    })
  })
})
