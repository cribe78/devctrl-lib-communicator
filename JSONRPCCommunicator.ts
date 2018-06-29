import {TCPCommunicator} from "./TCPCommunicator";
import {EndpointCommunicator, IEndpointCommunicatorConfig} from "./EndpointCommunicator";
import {IndexedDataSet} from "@devctrl/common";
import {JSONRPCCommand} from "./JSONRPCCommand";

export class JSONRPCCommunicator extends TCPCommunicator {
    responseCallbacks = {};
    commands: IndexedDataSet<JSONRPCCommand> = {};
    commandsByTemplate: IndexedDataSet<JSONRPCCommand> = {};


    constructor(config: IEndpointCommunicatorConfig) {
        super(config);
    }

    executeCommandQuery(command: JSONRPCCommand) {
        let queryObject = command.queryObject();
        let queryStr = JSON.stringify(queryObject);

        this.log("sending query: " + queryStr, EndpointCommunicator.LOG_POLLING);
        this.writeToSocket(queryStr);

        this.responseCallbacks[queryObject.id] = (resp) => {
            let val = command.extractQueryResponseValue(resp);

            for (let ctid of command.ctidList) {
                let control = this.controlsByCtid[ctid];
                //debug("control id is " + control._id);
                this.setControlValue(control, val);
            }
        }
    }


    onData(data: any) {
        let resp;
        let strData = String(data);
        this.log(`data received: ${strData}`, EndpointCommunicator.LOG_RAW_DATA);

        let objStrings = strData.split("}{");
        for (let i = 0; i <  objStrings.length; i++) {
            if (i > 0) {
                objStrings[i] = "{" + objStrings[i];
            }
            if (i != objStrings.length - 1) {
                objStrings[i] = objStrings[i] + "}";
            }
        }


        for(let objStr of objStrings) {
            try {
                resp = JSON.parse(objStr);
                this.onObject(resp);
            }
            catch (e) {
                this.log(`Error parsing response: ${e.message}  Data: ${objStr}`, EndpointCommunicator.LOG_MATCHING);
            }
        }
    }

    onObject(respObj: any) {
        if (this.responseCallbacks[respObj.id] !== undefined) {
            this.responseCallbacks[respObj.id](respObj);
            //TODO: check for error codes returned by device
            this.connectionConfirmed();
            delete this.responseCallbacks[respObj.id];
        }
        else {
            this.log(`no matching request for response id ${respObj.id}`, EndpointCommunicator.LOG_MATCHING);
        }
    }



}