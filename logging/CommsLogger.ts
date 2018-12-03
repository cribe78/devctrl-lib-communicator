import * as fs from 'fs';
import {DataDirection, LogLine} from "./LogLine";

export interface ICommsLoggerConfig {
  endpointId: string;
  logDir: string;
}


/*
* Log a full transcript of device communications
 */

export class CommsLogger {

  private writeStream: fs.WriteStream;
  private fd;

  constructor(public config: ICommsLoggerConfig) {
    if (! fs.existsSync(config.logDir)) {
      try {
        fs.mkdirSync(config.logDir);
      }
      catch(e) {
        throw new Error(`log dir ${config.logDir} does not exist and could not be created`);
      }
    }

    let filepath = config.logDir + "/" + config.endpointId + ".log";

    this.fd = fs.openSync(filepath, 'a+');
  }


  log(data: Buffer, direction: DataDirection, metadata: any = {}) {
    let ll = new LogLine(data, direction, metadata);
    fs.write(this.fd, ll.toBuffer(), () => {});
  }

}