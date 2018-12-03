import {DataDirection, LogLine} from "../../logging/LogLine";

describe('The log line class', function() {
  it('creates from a data buffer', function() {
    let buf = Buffer.from('test data');
    let line = new LogLine(buf, DataDirection.in, { method: 'POST'});

    let lineBuf = line.toBuffer();

    let line2 = new LogLine(lineBuf, DataDirection.parse);

    expect(line2.data.toString()).toBe("test data");
    expect(line2.direction).toBe(DataDirection.in);
    expect(line2.metadata.method).toBe('POST');
  })
});