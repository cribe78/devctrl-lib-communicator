import { IEndpointCommunicator, IEndpointCommunicatorConfig} from "./EndpointCommunicator";
import {
    Control,
    ControlUpdateData,
    IEndpointStatus,
    IndexedDataSet
} from "@devctrl/common";


export class DummyCommunicator implements IEndpointCommunicator {
    config: IEndpointCommunicatorConfig;
    epStatus : IEndpointStatus;
    controls: IndexedDataSet<Control> = {};


    constructor(config: IEndpointCommunicatorConfig) {
        this.config = config;
        this.epStatus = this.config.endpoint.epStatus;
    }



    getControlTemplates() {
        return {};
    }
    /**
     * Process a ControlUpdate, just echo a successful change
     * @param request
     */
    handleControlUpdateRequest(request: ControlUpdateData) {
        let control = this.controls[request.control_id];
        this.config.controlUpdateCallback(control, request.value);
    }


    initStatus() {
        // Enabled set server side, messengerConnected set by communicator, other values initialized to true
        let es = this.epStatus;
        es.reachable = true;
        es.connected = true;
        es.loggedIn = true;
        es.polling = true;
        es.responsive = true;
        es.ok = true;
        this.config.statusUpdateCallback();
    }

    log(msg: string, tag: string) {
        console.log(msg);
    }

    reset() {
        this.initStatus();
    }

    run() {
        this.initStatus();
    }

    setTemplates(controls: IndexedDataSet<Control>) {
        this.controls = controls;
    }


    updateStatus(status: IEndpointStatus) {
        //No need to actually do anything here
    }
}