/** 1 Server-Sent Events message. */
export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

/**
 * Incremental parser for the text/event-stream format (WHATWG HTML, section 9.2).
 * Feed it text as it arrives, in chunks of any size. It returns each complete message.
 */
export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];
  private id: string | undefined;

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const messages: SseMessage[] = [];
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (!match) break;
      // A lone \r at the very end may be the first half of \r\n, so wait for more text.
      if (match[0] === '\r' && match.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const message = this.line(line);
      if (message) messages.push(message);
    }
    return messages;
  }

  private line(line: string): SseMessage | undefined {
    if (line === '') {
      if (this.data.length === 0) {
        this.event = '';
        return undefined;
      }
      const message: SseMessage = { event: this.event || 'message', data: this.data.join('\n') };
      if (this.id !== undefined) message.id = this.id;
      this.event = '';
      this.data = [];
      return message;
    }
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    else if (field === 'id' && !value.includes('\0')) this.id = value;
    return undefined;
  }
}
