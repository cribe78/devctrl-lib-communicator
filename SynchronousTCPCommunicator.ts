import {TCPCommand} from "./TCPCommand";
import {TCPCommunicator} from "./TCPCommunicator";
import {EndpointCommunicator} from "./EndpointCommunicator";
import {IDCCommand} from "./IDCCommand";
import {IDCExpectedResponse} from "./IDCExpectedResponse";
import {DataDirection} from "./logging/LogLine";


export class SynchronousTCPCommunicator extends TCPCommunicator {
  commandQueue : string[] = [];
  expectedResponsesQueue: IDCExpectedResponse[] = [];
  commandQueueRunning = false;
  commandTimeoutTimer : any = 0;
  commandTimeoutDuration : number = 400;


  onData(data: any) {
    this.commsLogger.log(data, DataDirection.in);
    let strData = '';
    if (this.commsMode == 'string') {
      strData = String(data);
    }
    else if (this.commsMode == 'hex') {
      strData = data.toString('hex');
    }

    this.log("data received: " + strData, EndpointCommunicator.LOG_RAW_DATA);

    this.inputBuffer += strData;
    let lines = this.inputBuffer.split(this.inputLineTerminator);

    while (lines.length > 1) {
      this.processLine(lines[0]);
      lines.splice(0,1);
      this.runNextCommand();
    }

    this.inputBuffer = lines[0];
  }


  queueCommand(cmdStr : string, expectedResponse: IDCExpectedResponse) {
    this.commandQueue.push(cmdStr);
    this.expectedResponsesQueue.push(expectedResponse);

    if (! this.commandQueueRunning) {
      this.runCommandQueue();
    }
  }


  runCommandQueue() {
    if (this.commandQueueRunning) {
      return;
    }

    this.commandQueueRunning = true;
    this.runNextCommand();
  }

  runNextCommand() {
    // If we are out of commands, reset the queues and stop
    if (this.commandTimeoutTimer) {
      clearTimeout(this.commandTimeoutTimer);
    }
    this.commandTimeoutTimer = 0;

    if (this.commandQueue.length == 0 ||
      this.expectedResponsesQueue.length == 0 ||
      ! this.socket) {
      this.commandQueueRunning = false;
      this.commandQueue = [];
      this.expectedResponsesQueue = [];
      return;
    }

    let command = this.commandQueue[0];
    let expectedResponse = this.expectedResponsesQueue[0];

    this.commandQueue.splice(0, 1);
    this.expectedResponsesQueue.splice(0,1);

    this.expectedResponses = [expectedResponse];


    let logCommand = command.replace(/\r?\n|\r/g, '');
    this.log("sending command: " + logCommand, EndpointCommunicator.LOG_RAW_DATA);
    this.writeToSocket(command);

    if (expectedResponse[0] == '') {
      expectedResponse[1]('');
    }
    else {
      this.commandTimeoutTimer = setTimeout(() => {
        //TODO: if this timeout is reached, things get fucked up if responses come in eventually
        this.log(`response timeout reached, nothing heard`, EndpointCommunicator.LOG_CONNECTION);
        this.runNextCommand()
      }, this.commandTimeoutDuration);
    }
  }
}