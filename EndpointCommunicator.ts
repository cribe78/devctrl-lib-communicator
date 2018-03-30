    import * as cp from "child_process";
    import {
        Control,
        ControlUpdateData,
        IEndpointStatus,
        Endpoint,
        IndexedDataSet
    } from "@devctrl/common";

    export interface ICommunicatorProtoPackage {
        communicators: {
            [index: string] : typeof EndpointCommunicator
        }
    }

    export interface IEndpointCommunicatorConfig {
        endpoint: Endpoint
        controlUpdateCallback: (control: Control, value: any) => void;
        statusUpdateCallback: () => void;
    }

    export interface IEndpointCommunicator {
        getControlTemplates() : IndexedDataSet<Control>;
        handleControlUpdateRequest(update: ControlUpdateData);
        log(msg: string, tag: string);
        reset();
        run();
        setTemplates(controls: IndexedDataSet<Control>);
        updateStatus(status: IEndpointStatus);
        epStatus : IEndpointStatus;
    }


    export class EndpointCommunicator implements IEndpointCommunicator {
        controlsByCtid: IndexedDataSet<Control> = {};
        controls: IndexedDataSet<Control> = {};
        config: IEndpointCommunicatorConfig;
        indeterminateControls : { [idx: string] : boolean} = {};
        epStatus : IEndpointStatus;
        protected pingProcess: cp.ChildProcess;
        protected lastConfirmedCommunication = 0;
        protected backoffTime: number = 1000;
        protected pollTimer: any = 0;
        protected monitorTimer: any = 0;
        protected running = false;
        protected lastLogMsg = "";
        protected lastLogTime = 0;
        protected lastLogCount = 0;

        constructor(config: IEndpointCommunicatorConfig) {
            this.config = config;
            this.epStatus = this.config.endpoint.epStatus;
        }


        protected connectionConfirmed() {
            this.backoffTime = 1000;
            this.lastConfirmedCommunication = Date.now();
            this.updateStatus({ responsive: true });
        }


        get endpoint() : Endpoint {
            return this.config.endpoint;
        }

        get endpoint_id() : string {
            return this.config.endpoint._id;
        }



        static LOG_POLLING  = "polling";
        static LOG_MATCHING = "matching";
        static LOG_RAW_DATA = "rawData";
        static LOG_CONNECTION = "connection";
        static LOG_UPDATES = "updates";
        static LOG_DATA_MODEL = "dataModel";
        static LOG_STATUS = "status";


        getControlTemplates() : IndexedDataSet<Control> {
            return {};
        }

        /**
         * Process a ControlUpdate, likely by sending a command to
         * a device
         * @param request
         */
        handleControlUpdateRequest(request: ControlUpdateData) {
            throw new Error("handleControlUpdateRequest must be implemented by Communicator");
        }


        initStatus() {
            // Enabled set server side, messengerConnected set by communicator, other values initialized to false
            let es = this.epStatus;
            es.reachable = false;
            es.connected = false;
            es.loggedIn = false;
            es.responsive = false;
            es.ok = false;
            this.config.statusUpdateCallback();
        }


        /**
         * Many subclasses will find this useful.  Some will not.
         */

        protected launchPing() {
            if (this.pingProcess) {
                this.pingProcess.removeAllListeners('exit');  // Prevent multiplication of ping processes
                this.pingProcess.kill('SIGHUP');
            }


            // Specify -c 10 to make sure ping process doesn't run on forever after this process
            // has exited.
            this.pingProcess = cp.spawn("ping",["-i", "5", "-c", "10", this.endpoint.address]);
            this.log("ping process launched", EndpointCommunicator.LOG_CONNECTION);

            this.pingProcess.stdout.setEncoding('utf8');
            this.pingProcess.stdout.on('data', (data) => {
                let str = data.toString();
                if (str.includes("bytes from")) {
                    //success
                    this.updateStatus({ reachable: true });
                }
                else if (str.includes("Unreachable")) {
                    this.updateStatus({reachable: false});
                }
            });

            this.pingProcess.stderr.on('data', (data) => {
                let str = data.toString();
                this.log(`ping process STDERR: ${str}`);
            });

            this.pingProcess.on('exit', (code) => {
                this.log("ping process exited, relaunching", EndpointCommunicator.LOG_CONNECTION);
                this.launchPing();
            });

        }

        /**
         * A function to log messages.  Determine which messages to log by setting the commLogOptions value on a
         * per-device basis through the application UI.  commLogOptions should be a comma separated list of tags.
         * Tags used by base classes are: polling, updates, matching, rawData, connection, updates
         *
         * @param msg  message to be logged
         * @param tag  message tag, message will only be logged if tag is matched in commLogOptions
         */
        log(msg: string, tag = "default") {
            let opts = this.config.endpoint.commLogOptionsObj;

            if (opts[tag]) {
                if (msg != this.lastLogMsg) {
                    if (this.lastLogCount > 0) {
                        let repeatMsg = `previous message repeated ${this.lastLogCount} times`;
                        console.log(repeatMsg);
                    }

                    console.log(msg);
                    this.lastLogCount = 0;
                    this.lastLogTime = Date.now();
                    this.lastLogMsg = msg;
                }
                else {
                    if (Date.now() - this.lastLogTime > 60000) {
                        let repeatMsg = `previous message repeated ${this.lastLogCount} times`;
                        console.log(repeatMsg);
                        console.log(msg);
                        this.lastLogCount = 0;
                        this.lastLogTime = Date.now();
                        this.lastLogMsg = msg;
                    }
                    else {
                        this.lastLogCount++;
                    }
                }

            }
            else if (opts["all"]) {
                console.log(msg);
            }
        }


        registerControl(control: Control) {
            if (this.controlsByCtid[control.ctid]) {
                throw new Error(`duplicate ctid ${control.ctid} registered`);
            }

            this.controlsByCtid[control.ctid] = control;

        }


        registerHyperlinkControl(config: any, name = "Device Web Interface", cmd = "hyperlink") {
            let ctid = this.endpoint_id + "-" + cmd;

            if (this.controlsByCtid[ctid]) {
                throw new Error(`duplicate ctid ${ctid} registered`);
            }

            this.controlsByCtid[ctid] = new Control(ctid, {
                _id : ctid,
                ctid: ctid,
                endpoint_id: this.endpoint_id,
                usertype: Control.USERTYPE_HYPERLINK,
                name: name,
                control_type: Control.CONTROL_TYPE_STRING,
                poll: 0,
                config: config,
                value: ""
            });

        }


        reset() {
            this.run();
        }

        /**
         * Call this once, after the object has been created, the config has been set
         */
        run() {
            if (! this.running) {
                this.initStatus();
                this.running = true;
            }
            this.updateStatus({});  //  This triggers the execution loop
        }

        setControlValue(control: Control, val: any) {
            let valDiff = control.value != val;
            if (typeof val == 'object') {
                // Don't send update if nothing will change
                valDiff = JSON.stringify(control.value) != JSON.stringify(val);
            }

            if (valDiff || this.indeterminateControls[control._id]) {
                this.indeterminateControls[control._id] = false;

                this.config.controlUpdateCallback(control, val);
                control.value = val;
            }
        }

        setTemplates(controls: IndexedDataSet<Control>) {
            this.controls = controls;

            for (let id in controls) {
                let ctid = controls[id].ctid;
                let localControl = this.controlsByCtid[ctid];


                this.controlsByCtid[ctid] = controls[id];

                if (! localControl) {
                    this.log("setTemplates: No control located for ctid " + ctid);
                }
                else {
                    // Set value of remote control to match local
                    this.setControlValue(controls[id], localControl.value);
                }
            }
        }

        /**
         * The device connection lifecycle is driven by these status updates.  Implement this logic in a subclass
         * @param {} status
         */
        updateStatus(status: IEndpointStatus) {
            this.log("updateStatus not implemented by Communicator class, not much is gonna happen");
        }

    }