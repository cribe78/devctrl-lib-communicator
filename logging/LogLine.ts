

export enum DataDirection {
  in,  // Data received by communicator from device
  out, // Data send to device from communicator
  parse // Buffer is a previously serialized LogLine
}


export class LogLine {
  timestamp: number;

  constructor(public data: Buffer, public direction: DataDirection, public metadata: any = {}) {
    this.timestamp = Date.now();

    if (direction === DataDirection.parse) {
      this.parse(data);
    }
  }


  parse(buf: Buffer, offset = 0) {
    const lineLen = buf.readDoubleBE(offset + 0);

    if (offset + lineLen > buf.length) {
      throw new Error(`line length ${lineLen} + offset ${offset} excedes buffer size ${buf.length}`);
    }

    this.direction = buf.readUInt8(offset + 8);
    this.timestamp = buf.readDoubleBE(offset + 9);
    let dataLen = buf.readDoubleBE(offset + 17);
    let mdLen = buf.readDoubleBE(offset + 25);

    this.data = Buffer.alloc(dataLen);
    buf.copy(this.data, 0, offset + 33, offset + 33 + dataLen);

    let mdStr = buf.toString('utf8', offset + 33 + dataLen, offset + 33 + dataLen + mdLen);
    this.metadata = JSON.parse(mdStr);
  }

  /*
  * Returns the serialized object
  * byte 0: total length
  * byte 8: direction
  * byte 9: timestamp
  * byte 17: string length
  * byte 25: metadata length (json)
  * byte 33: string
  * byte 33 + string length: metadata (json)
   */

  toBuffer() : Buffer {
    let mdJSON = JSON.stringify(this.metadata);
    let mdLen = Buffer.byteLength(mdJSON);
    let len = 33 + this.data.length + mdLen;

    let buf = Buffer.alloc(len);

    buf.writeDoubleBE(len, 0);
    buf.writeUInt8(this.direction, 8);
    buf.writeDoubleBE(this.timestamp, 9);
    buf.writeDoubleBE(this.data.length, 17);
    buf.writeDoubleBE(mdLen, 25);
    this.data.copy(buf, 33);
    buf.write(mdJSON, 33 + this.data.length);

    return buf;
  }
}