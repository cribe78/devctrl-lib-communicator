import {TCPCommunicator} from "./TCPCommunicator";
import {EndpointCommunicator, IEndpointCommunicatorConfig} from "./EndpointCommunicator";
import {IndexedDataSet} from "@devctrl/common";

export class JSONRPCCommunicator extends TCPCommunicator {
    commandsSent = {};

    constructor(config: IEndpointCommunicatorConfig) {
        super(config);
    }

    onData(data: any) {
        let resp;
        let strData = String(data);
        this.log(`data received: ${strData}`, EndpointCommunicator.LOG_RAW_DATA);

        try {
            resp = JSON.parse(strData);
        }
        catch(e) {
            this.log(`Error parsing response: ${e.error}  Data: ${strData}`, EndpointCommunicator.LOG_MATCHING);
            return;
        }



    }
}