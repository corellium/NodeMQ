# LD 1/14/26

import random
import math

##################
# DEFINES
##################
def Sequencer():
    # variables
    #all uppercase variables refers to register bits from max30123
    timer = 0 # variable keeping track of when measurements occur in FIFO
    CONV_LIST = [200, 100, 40, 20, 33.33, 16.67, 2.76, 1.38] # used to convert bit number to value
    CHRONO_DELAY_LIST = [0.0248, 0.0496, 0.0744, 0.0992, 0.124, 0.1488, 0.1736, 0.1984] # used to convert bit number to value
    Tpre = 2.5 # time in ms for pre measurement, inherent to the max30123
    Tsetup = 1 # time in ms for setup measurement, inherent to the max30123
    set_time = 300000 # time to run automode in ms, probably handle this differently in the future based upon start/stop button presses in the GUI
    meas_list = []

    #general registers
    AUTO_MODE = (int(reg_data[reg_addr.index('60')],16) & 0b00000010) >> 1 #Find if part is set to auto mode
    SAMPLE_COUNT = int(reg_data[reg_addr.index('61')],16) #get SAMPLE_COUNT
    SEQ_RESTART = (int(reg_data[reg_addr.index('60')],16) & 0b10000000) >> 7 #get SEQ_RESTART bit
    print(SEQ_RESTART)
    I_CONV_TYPE = []
    V_CONV_TYPE = []
    Mn_SRD = []
    CONV_TIME = []

    #chrono registers
    AUTO_SUBTRACT_A = (int(reg_data[reg_addr.index('37')],16) & 0b00001000) >> 3 #find auto subtract bit
    POST_PULSE_EN_A = (int(reg_data[reg_addr.index('37')],16) & 0b00100000) >> 5 #find post pulse enable bit
    CHRONOA_DELAYms = CHRONO_DELAY_LIST[(int(reg_data[reg_addr.index('37')],16) & 0b00000111)]
    CHRONOA_PRE = ((int(reg_data[reg_addr.index('37')],16) & 0b11000000)>>6)+1 #find number of chrono pre samples
    CHRONOA_STEP = int(reg_data[reg_addr.index('38')],16) + 1 # number of chrono step samples
    CHRONOA_POST = int(reg_data[reg_addr.index('39')],16)   # number of chrono post samples
    CHRONOA_BLANK = int(reg_data[reg_addr.index('3A')],16) + 1 #number of blank periods
    CHRONOA_REPEAT = int(reg_data[reg_addr.index('3B')],16) + 1 # number of chrono repeats

    AUTO_SUBTRACT_B = (int(reg_data[reg_addr.index('3D')], 16) & 0b00001000) >> 3  # find auto subtract bit
    POST_PULSE_EN_B = (int(reg_data[reg_addr.index('3D')], 16) & 0b00100000) >> 5  # find post pulse enable bit
    CHRONOB_DELAYms = CHRONO_DELAY_LIST[(int(reg_data[reg_addr.index('3D')], 16) & 0b00000111)]
    CHRONOB_PRE = ((int(reg_data[reg_addr.index('3D')], 16) & 0b11000000) >> 6) + 1  # find number of chrono pre samples
    CHRONOB_STEP = int(reg_data[reg_addr.index('3E')], 16) + 1  # number of chrono step samples
    CHRONOB_POST = int(reg_data[reg_addr.index('3F')], 16)  # number of chrono post samples
    CHRONOB_BLANK = int(reg_data[reg_addr.index('40')], 16) + 1  # number of blank periods
    CHRONOB_REPEAT = int(reg_data[reg_addr.index('41')], 16) + 1  # number of chrono repeats

    #Arbitrary Pulse registers
    AP_STEP = int(reg_data[reg_addr.index('5B')], 16)
    if AP_STEP < 2:
        AP_STEP = 2
    AP_REC = int(reg_data[reg_addr.index('5C')], 16)
    if AP_REC < 2:
        AP_REC = 2
    ISP_MULT = int(reg_data[reg_addr.index('5D')], 16)
    if ISP_MULT < 1:
        ISP_MULT = 1

    #voltage registers
    TEMP_PIN_SEL = int(reg_data[reg_addr.index('84')],16) & 0b00000011 #mask off all bits except [1:0]
    if TEMP_PIN_SEL > 2: #dont allow temp pin select to be set to 3, reserved value
        TEMP_PIN_SEL = 2
    GR1_VSEL = (int(reg_data[reg_addr.index('85')],16) & 0b01000000) >> 6
    CE1_VSEL = (int(reg_data[reg_addr.index('85')], 16) & 0b00010000) >> 4
    RE1_VSEL = (int(reg_data[reg_addr.index('85')], 16) & 0b00001000) >> 2
    WE1_VSEL = (int(reg_data[reg_addr.index('85')], 16) & 0b00000001)
    VREF_SW_VSEL = (int(reg_data[reg_addr.index('86')], 16) & 0b01000000) >> 6
    VNCP_VSEL = (int(reg_data[reg_addr.index('86')], 16) & 0b00100000) >> 5
    VDD_VSEL = (int(reg_data[reg_addr.index('86')], 16) & 0b00010000) >> 4
    VREF_VSEL = (int(reg_data[reg_addr.index('86')], 16) & 0b00001000) >> 3
    VBAT_VSEL = (int(reg_data[reg_addr.index('86')], 16) & 0b00000100) >> 2
    GPIO1_VSEL = (int(reg_data[reg_addr.index('86')], 16) & 0b00000010) >> 1
    GPIO2_VSEL = int(reg_data[reg_addr.index('86')], 16) & 0b00000001

    #Get max30123 Clock settings
    AUTO_CLK_DIV = int(reg_data[reg_addr.index('15')],16)<<16 | int(reg_data[reg_addr.index('16')],16)<<8 | int(reg_data[reg_addr.index('17')],16)
    if AUTO_CLK_DIV < 0x80: #as stated in DS cannot be less than 0x80
        AUTO_CLK_DIV = 0x80
    SSPms = (AUTO_CLK_DIV/32768)*1000 #get the Sequence Sample Period in ms

    CHRONO_CLK_DIV = int(reg_data[reg_addr.index('18')],16)<<8 | int(reg_data[reg_addr.index('19')],16)
    if CHRONO_CLK_DIV < 0x80: #as stated in DS cannot be less than 0x80
        CHRONO_CLK_DIV = 0x80
    ISPms = (CHRONO_CLK_DIV/32768)*1000 #Get the chron sample period in ms

    #read enabled measurements and put them in meas_list[]
    for n in range (7): #check M0-M6
        addr=0x62+(n*2) #find all Mn modes
        addr = hex(addr)[2:] #format in hex without "0x" instead of int
        Mn_MODE = int(reg_data[reg_addr.index(str(addr).upper())],16) #read register data, must format as uppercase string
        Mn_MODE = Mn_MODE>>5 #shift right 5 to get only bits [7:5] from Mn Mode register
        meas_list.append(Mn_MODE) #add meas mode to list, disabled measurements will be 0
        #print(meas_list[n])
        if n == 0:
            Mn_SRD.append(1) #M0 SRD always set to 1, cannot change
        else:
            Mn_skip = int(reg_data[reg_addr.index(str(addr).upper())],16) #read register data, must format as uppercase string
            Mn_skip = (Mn_skip & 0b00011111) + 1
            Mn_SRD.append(Mn_skip)

    #create measurement timing
    for i in range (7): #M0-M6
        I_CONV_TYPE.append(0) #fill with 0, will be changed up ahead if needed in measurement
        V_CONV_TYPE.append(0)
        CONV_TIME.append(0)
        if meas_list[i] == 1: #PSTAT
            #determine I_CONV_TYPE
            addr = 0x70 + (i * 2)  # find Mn_I_CONV_TYPE addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            conv_type = int(reg_data[reg_addr.index(str(addr).upper())],16)  # read register data, must format as uppercase string
            conv_type = conv_type >> 6
            I_CONV_TYPE[i] = conv_type
            #print(I_CONV_TYPE[i])

            addr = 0x70 + (i * 2)  # find Mn_CONV_TIME addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            mn_time = int(reg_data[reg_addr.index(str(addr).upper())],16)
            mn_time = mn_time & 0b00000111 #mask off bits besides [2:0]

            addr = 0x63 + (i * 2)  # find Mn_DELAY addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            delay_val = int(reg_data[reg_addr.index(str(addr).upper())], 16)
            if delay_val > 6: #cannot be greater than 6 as stated in DS
                delay_val = 6
            Tdelay = (75 + delay_val)/32.768 #set Tdelay from delay_val bits

            conv_time = CONV_LIST[mn_time]+Tpre+Tdelay #add conversion time + tpre + Tdelay
            CONV_TIME[i] = conv_time #add conversion time to list for the Mn measurement
            #print(CONV_TIME[i])

        elif meas_list[i] == 2: #chrono A
            # determine I_CONV_TYPE
            addr = 0x70 + (i * 2)  # find Mn_I_CONV_TYPE addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            conv_type = int(reg_data[reg_addr.index(str(addr).upper())],16)  # read register data, must format as uppercase string
            conv_type = conv_type >> 6
            I_CONV_TYPE[i] = conv_type
            #print(I_CONV_TYPE[i])

            addr = 0x70 + (i * 2)  # find Mn_CONV_TIME addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            mn_time = int(reg_data[reg_addr.index(str(addr).upper())], 16)
            mn_time = mn_time & 0b00000111  # mask off bits besides [2:0]

            addr = 0x63 + (i * 2)  # find Mn_DELAY addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            delay_val = int(reg_data[reg_addr.index(str(addr).upper())], 16)
            if delay_val > 6:
                delay_val = 6
            Tdelay = (75 + delay_val) / 32.768

            conv_time = CONV_LIST[mn_time] + Tpre + Tdelay  # add conversion time + tpre + tsetup + Tdelay
            CONV_TIME[i] = conv_time  # add conversion time to list for Mn
            #print(CONV_TIME[i])

        elif meas_list[i] == 3: #chrono B
            # determine I_CONV_TYPE
            addr = 0x70 + (i * 2)  # find Mn_I_CONV_TYPE addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            conv_type = int(reg_data[reg_addr.index(str(addr).upper())],16)  # read register data, must format as uppercase string
            conv_type = conv_type >> 6
            I_CONV_TYPE[i] = conv_type
            #print(I_CONV_TYPE[i])

            addr = 0x70 + (i * 2)  # find Mn_CONV_TIME addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            mn_time = int(reg_data[reg_addr.index(str(addr).upper())], 16)
            mn_time = mn_time & 0b00000111  # mask off bits besides [2:0]

            addr = 0x63 + (i * 2)  # find Mn_DELAY addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            delay_val = int(reg_data[reg_addr.index(str(addr).upper())], 16)
            if delay_val > 6:
                delay_val = 6
            Tdelay = (75 + delay_val) / 32.768

            conv_time = CONV_LIST[mn_time] + Tpre + Tdelay  # add conversion time + tpre + Tdelay
            CONV_TIME[i] = conv_time  # add conversion time to list
            #print(CONV_TIME[i])

        elif meas_list[i] == 4: #AP
            # determine I_CONV_TYPE
            addr = 0x70 + (i * 2)  # find Mn_I_CONV_TYPE addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            conv_type = int(reg_data[reg_addr.index(str(addr).upper())],
                            16)  # read register data, must format as uppercase string
            conv_type = conv_type >> 6
            I_CONV_TYPE[i] = conv_type
            # print(I_CONV_TYPE[i])

            addr = 0x70 + (i * 2)  # find Mn_CONV_TIME addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            mn_time = int(reg_data[reg_addr.index(str(addr).upper())], 16)
            mn_time = mn_time & 0b00000111  # mask off bits besides [2:0]

            addr = 0x63 + (i * 2)  # find Mn_DELAY addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            delay_val = int(reg_data[reg_addr.index(str(addr).upper())], 16)
            if delay_val > 6:
                delay_val = 6
            Tdelay = (75 + delay_val) / 32.768

            conv_time = CONV_LIST[mn_time] + Tpre + Tdelay  # add conversion time + tpre + Tdelay
            CONV_TIME[i] = conv_time  # add conversion time to list
            #print(CONV_TIME[i])

        elif meas_list[i] == 6: #temperature
            # determine V_CONV_TYPE
            addr = 0x70 + (i * 2)  # find Mn_V_CONV_TYPE addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            conv_type = int(reg_data[reg_addr.index(str(addr).upper())],16)  # read register data, must format as uppercase string
            conv_type = conv_type & 0b00010000 #mask bits, only need 5th bit
            conv_type = conv_type >> 4 #shift 4 over to get only 5th bit
            V_CONV_TYPE[i] = conv_type #add to V conv list
            #print(V_CONV_TYPE[i])
            addr = 0x70 + (i * 2)  # find Mn_CONV_TIME addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            mn_time = int(reg_data[reg_addr.index(str(addr).upper())], 16)
            mn_time = mn_time & 0b00000111  # mask off bits besides [2:0]

            addr = 0x63 + (i * 2)  # find Mn_DELAY addr, starts at reg 0x63 + every 2 registers after
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            delay_val = int(reg_data[reg_addr.index(str(addr).upper())], 16)
            if delay_val > 6:
                delay_val = 6
            Tdelay = (75 + delay_val) / 32.768

            conv_time = CONV_LIST[mn_time] + Tpre + Tdelay  # add conversion time + tpre + Tdelay
            CONV_TIME[i] = conv_time  # add conversion time to list
            #print(CONV_TIME[i])
        elif meas_list[i] == 7: #voltage
            # determine V_CONV_TYPE
            addr = 0x70 + (i * 2)  # find Mn_V_CONV_TYPE addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            conv_type = int(reg_data[reg_addr.index(str(addr).upper())],16)  # read register data, must format as uppercase string
            conv_type = conv_type & 0b00010000  # mask bits, only need 5th bit
            conv_type = conv_type >> 4  # shift 4 over to get only 5th bit
            V_CONV_TYPE[i] = conv_type  # add to V conv list
            #print(V_CONV_TYPE[i])
            addr = 0x70 + (i * 2)  # find Mn_CONV_TIME addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            mn_time = int(reg_data[reg_addr.index(str(addr).upper())], 16)
            mn_time = mn_time & 0b00000111  # mask off bits besides [2:0]

            addr = 0x63 + (i * 2)  # find Mn_DELAY addr
            addr = hex(addr)[2:]  # format in hex without "0x" instead of int
            delay_val = int(reg_data[reg_addr.index(str(addr).upper())], 16)
            if delay_val > 6:
                delay_val = 6
            Tdelay = (75 + delay_val) / 32.768

            conv_time = CONV_LIST[mn_time] + Tpre + Tdelay  # add conversion time + tpre + Tdelay
            CONV_TIME[i] = conv_time  # add conversion time to list
            #print(CONV_TIME[i])

    #create output list with time, type, Mn, tag
    if AUTO_MODE == 0: #if part is set to manual mode, dont care about Skip rate
        #run all Mn once into list
        for i in range (7):
            if meas_list[i] == 1: #PSTAT
                if I_CONV_TYPE[i] == 0: #offset+current meas
                    timer = timer + Tsetup + CONV_TIME[i] #add conversion time to the timer
                    output_list.append([timer,'PSTAT', i,'1']) #add to output list
                elif I_CONV_TYPE[i] == 1: #offset only meas
                    timer = timer + Tsetup + CONV_TIME[i]
                    output_list.append([timer, 'PSTAT', i,'0']) #add to output list
                elif I_CONV_TYPE[i] == 2: #offset and signal + offset  meas
                    timer = timer + Tsetup + CONV_TIME[i]
                    output_list.append([timer, 'PSTAT', i,'0']) #add to output list
                    timer = timer + CONV_TIME[i]
                    output_list.append([timer, 'PSTAT', i, '1'])  # add to output list
                elif I_CONV_TYPE[i] == 3: #offset+signal signed meas
                    timer = timer + Tsetup + CONV_TIME[i]
                    output_list.append([timer, 'PSTAT', i,'1']) #add to output list
            elif meas_list[i] == 2: #CHRONO A
                for y in range(CHRONOA_REPEAT):
                    if (AUTO_SUBTRACT_A == 1 and I_CONV_TYPE[i] == 3): #auto subtract mode, no pre samples
                        for x in range(CHRONOA_PRE): #presamples still occur but do not get put in FIFO in this config
                            timer = timer + Tsetup + CONV_TIME[i] #add to timer for each pre sample, but dont put it in FIFO since auto subtract
                        timer = timer + CHRONOA_DELAYms #add delay after pre samples
                        for x in range(CHRONOA_STEP):
                            timer = timer + Tsetup + CONV_TIME[i]
                            output_list.append([timer, 'CHRONO A', i, '3']) #add steps to output list
                        timer = timer + CHRONOA_DELAYms #add delay after step samples
                        if(CHRONOA_POST > 0):
                            for x in range(CHRONOA_POST):
                                timer = timer + Tsetup + CONV_TIME[i]
                                output_list.append([timer, 'CHRONO A', i, '4']) #add post pulses to output list
                        elif (POST_PULSE_EN_A == 1):
                            #add to list the number in STEP instead of POST
                            for x in range(CHRONOA_STEP):
                                timer = timer + Tsetup + CONV_TIME[i]
                                output_list.append([timer, 'CHRONO A', i, '4'])  # add post STEP pulses to output list
                        for x in range(CHRONOA_BLANK):
                            timer = timer + Tsetup + CONV_TIME[i]
                    else:
                        for x in range(CHRONOA_PRE):
                            timer = timer + Tsetup + CONV_TIME[i] #add to timer for each pre sample
                            output_list.append([timer, 'CHRONO A', i, '2']) #add pre to output list
                        timer = timer + CHRONOA_DELAYms #add delay after pre samples
                        for x in range(CHRONOA_STEP):
                            timer = timer + Tsetup + CONV_TIME[i]
                            output_list.append([timer, 'CHRONO A', i, '3']) #add steps to output list
                        timer = timer + CHRONOA_DELAYms #add delay after step samples
                        if(CHRONOA_POST > 0):
                            for x in range(CHRONOA_POST):
                                timer = timer + Tsetup + CONV_TIME[i]
                                output_list.append([timer, 'CHRONO A', i, '4']) #add post pulses to output list
                        elif (POST_PULSE_EN_A == 1):
                            #add to list the number in STEP instead of POST
                            for x in range(CHRONOA_STEP):
                                timer = timer + Tsetup + CONV_TIME[i]
                                output_list.append([timer, 'CHRONO A', i, '4'])  # add post pulses to output list
                        for x in range(CHRONOA_BLANK):
                            timer = timer + Tsetup + CONV_TIME[i]
            elif meas_list[i] == 3:
                for y in range(CHRONOB_REPEAT):
                    if (AUTO_SUBTRACT_B == 1 and I_CONV_TYPE[i] == 3):  # auto subtract mode, no pre samples
                        # presamples
                        for x in range(CHRONOB_PRE):
                            timer = timer + Tsetup + CONV_TIME[i]  # add to timer for each pre sample, but dont put it in FIFO since auto subtract
                        timer = timer + CHRONOB_DELAYms  # add delay after pre samples
                        for x in range(CHRONOB_STEP):
                            timer = timer + Tsetup + CONV_TIME[i]
                            output_list.append([timer, 'CHRONO B', i, '3'])  # add steps to output list
                        timer = timer + CHRONOB_DELAYms  # add delay after step samples
                        if (CHRONOB_POST > 0):
                            for x in range(CHRONOB_POST):
                                timer = timer + Tsetup + CONV_TIME[i]
                                output_list.append([timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                        elif (POST_PULSE_EN_B == 1):
                            # add to list the number in STEP
                            for x in range(CHRONOB_STEP):
                                timer = timer + Tsetup + CONV_TIME[i]
                                output_list.append([timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                        for x in range(CHRONOB_BLANK):
                            timer = timer + Tsetup + CONV_TIME[i]
                    else:
                        for x in range(CHRONOB_PRE):
                            timer = timer + Tsetup + CONV_TIME[i]  # add to timer for each pre sample
                            output_list.append([timer, 'CHRONO B', i, '2'])  # add pre to output list
                        timer = timer + CHRONOB_DELAYms  # add delay after pre samples
                        for x in range(CHRONOB_STEP):
                            timer = timer + Tsetup + CONV_TIME[i]
                            output_list.append([timer, 'CHRONO B', i, '3'])  # add steps to output list
                        timer = timer + CHRONOB_DELAYms  # add delay after step samples
                        if (CHRONOB_POST > 0):
                            for x in range(CHRONOB_POST):
                                timer = timer + Tsetup + CONV_TIME[i]
                                output_list.append([timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                        elif (POST_PULSE_EN_B == 1):
                            # add to list the number in STEP
                            for x in range(CHRONOB_STEP):
                                timer = timer + Tsetup + CONV_TIME[i]
                                output_list.append([timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                        for x in range(CHRONOB_BLANK):
                            timer = timer + Tsetup + CONV_TIME[i]
            elif meas_list[i] == 4: #Arbitrary Pulse
                if (I_CONV_TYPE[i] == 3):  # signal + offset has 2 conversions each time
                    for x in range(AP_STEP):
                        if x == 0: #first sample is taken and discarded
                            timer = timer + Tsetup + (CONV_TIME[i] * 2)
                        else:
                            timer = timer + Tsetup + CONV_TIME[i]
                            output_list.append([timer, 'AP', i, '0'])  # add offset to output list
                            timer = timer + CONV_TIME[i]
                            output_list.append([timer, 'AP', i, '3'])  # add steps to output list
                    for x in range(AP_REC):
                        if x == 0: #first sample is taken and discarded
                            timer = timer + Tsetup + (CONV_TIME[i] * 2)
                        else:
                            timer = timer + Tsetup + CONV_TIME[i]
                            output_list.append([timer, 'AP', i, '0'])  # add offset to output list
                            timer = timer + CONV_TIME[i]
                            output_list.append([timer, 'AP', i, '4'])  # add recovery to output list
                else: #other three I_CONV_TYPES are the same
                    for x in range(AP_STEP):
                        if x == 0: #first sample is taken and discarded
                            timer = timer + Tsetup + (CONV_TIME[i])
                        else:
                            timer = timer + Tsetup + CONV_TIME[i]
                            output_list.append([timer, 'AP', i, '3'])  # add steps to output list
                    for x in range(AP_REC):
                        if x == 0: #first sample is taken and discarded
                            timer = timer + Tsetup + (CONV_TIME[i])
                        else:
                            timer = timer + Tsetup + CONV_TIME[i]
                            output_list.append([timer, 'AP', i, '4'])  # add recovery to output list

            elif meas_list[i] == 6: #temperature
                if V_CONV_TYPE[i] == 0:
                    if TEMP_PIN_SEL == 0: #GPIO1 temp
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i] #offset and signal measurement
                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                    elif TEMP_PIN_SEL == 1: #GPIO2 temp
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i]  # offset and signal measurement
                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                    elif TEMP_PIN_SEL == 2: #GPIO2 then GPIO1, no difference in tags
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i]  # offset and signal measurement
                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i]  # offset and signal measurement
                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                else:
                    timer = timer + Tsetup + CONV_TIME[i] #offset once measurement
                    if TEMP_PIN_SEL == 0: #GPIO1 temp
                        timer = timer + Tsetup + CONV_TIME[i] #signal measurement only
                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                    elif TEMP_PIN_SEL == 1: #GPIO2 temp
                        timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                    elif TEMP_PIN_SEL == 2: #GPIO2 then GPIO1, no difference in tags
                        timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                        timer = timer + Tsetup + CONV_TIME[i] # signal measurement only
                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
            elif meas_list[i] == 7: #voltage
                if V_CONV_TYPE[i] == 0:
                    if VREF_SW_VSEL == 1: #VREF SW Voltage
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i] #offset and signal measurement
                        output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                    if VNCP_VSEL == 1: #VNCP Voltage
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i]  # offset and signal measurement
                        output_list.append([timer, 'Negative Charge Pump Voltage', i, '1F'])
                    if VDD_VSEL == 1: #VDD Voltage
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i]  # offset and signal measurement
                        output_list.append([timer, 'VDD Voltage', i, '1D'])
                    if VREF_VSEL == 1: #VREF Voltage
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i]  # offset and signal measurement
                        output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                    if VBAT_VSEL == 1: #VBAT Voltage
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i]  # offset and signal measurement
                        output_list.append([timer, 'VBAT Voltage', i, '1B'])
                    if GPIO2_VSEL == 1: #GPIO2 Voltage
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i]  # offset and signal measurement
                        output_list.append([timer, 'GPIO2 Voltage', i, '1A'])
                    if GPIO1_VSEL == 1: #GPIO1 Voltage
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i]  # offset and signal measurement
                        output_list.append([timer, 'GPIO1 Voltage', i, '19'])
                    if GR1_VSEL == 1: #GR1 Voltage
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i]  # offset and signal measurement
                        output_list.append([timer, 'GR1 Voltage', i, '17'])
                    if CE1_VSEL == 1: #CE1 Voltage
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i]  # offset and signal measurement
                        output_list.append([timer, 'CE1 Voltage', i, '15'])
                    if RE1_VSEL == 1: #RE1 Voltage
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i]  # offset and signal measurement
                        output_list.append([timer, 'RE1 Voltage', i, '13'])
                    if WE1_VSEL == 1: #WE1 Voltage
                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[i]  # offset and signal measurement
                        output_list.append([timer, 'WE1 Voltage', i, '11'])
                else:
                    timer = timer + Tsetup + CONV_TIME[i] #offset once measurement
                    if VREF_SW_VSEL == 1:  # VREF SW Voltage
                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                        output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                    if VNCP_VSEL == 1:  # VNCP Voltage
                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                        output_list.append([timer, 'Negative Charge Pump Voltage', i, '1F'])
                    if VDD_VSEL == 1:  # VDD Voltage
                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                        output_list.append([timer, 'VDD Voltage', i, '1D'])
                    if VREF_VSEL == 1:  # VREF Voltage
                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                        output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                    if VBAT_VSEL == 1:  # VBAT Voltage
                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                        output_list.append([timer, 'VBAT Voltage', i, '1B'])
                    if GPIO2_VSEL == 1:  # GPIO2 Voltage
                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                        output_list.append([timer, 'GPIO2 Voltage', i, '1A'])
                    if GPIO1_VSEL == 1:  # GPIO1 Voltage
                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                        output_list.append([timer, 'GPIO1 Voltage', i, '19'])
                    if GR1_VSEL == 1:  # GR1 Voltage
                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                        output_list.append([timer, 'GR1 Voltage', i, '17'])
                    if CE1_VSEL == 1:  # CE1 Voltage
                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                        output_list.append([timer, 'CE1 Voltage', i, '15'])
                    if RE1_VSEL == 1:  # RE1 Voltage
                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                        output_list.append([timer, 'RE1 Voltage', i, '13'])
                    if WE1_VSEL == 1:  # WE1 Voltage
                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                        output_list.append([timer, 'WE1 Voltage', i, '11'])

    else: #Auto mode = 1 (enabled) can loop through measurements multiple times
        sample_counter = 0 #tracks which sample period we are currently on
        if SEQ_RESTART == 0: #will restart automatically after M5 and M6
            while timer < set_time: #this runs auto mode for as long as value in set_time
                while sample_counter < SAMPLE_COUNT:
                    for i in range(4): #run first 4 measurements M0-M3
                        if (sample_counter+1)%Mn_SRD[i] == 0: #Skip rate divider check, start at frame 1 instead of 0
                            if meas_list[i] == 1:  # PSTAT
                                if I_CONV_TYPE[i] == 0:  # offset+current meas
                                    timer = timer + Tsetup + CONV_TIME[i]  # add conversion time to the timer
                                    output_list.append([timer, 'PSTAT', i, '1'])  # add to output list
                                elif I_CONV_TYPE[i] == 1:  # offset only meas
                                    timer = timer + Tsetup + CONV_TIME[i]
                                    output_list.append([timer, 'PSTAT', i, '0'])  # add to output list
                                elif I_CONV_TYPE[i] == 2:  # offset and signal + offset  meas
                                    timer = timer + Tsetup + CONV_TIME[i]
                                    output_list.append([timer, 'PSTAT', i, '0'])  # add to output list
                                    timer = timer + CONV_TIME[i]
                                    output_list.append([timer, 'PSTAT', i, '1'])  # add to output list
                                elif I_CONV_TYPE[i] == 3:  # offset+signal signed meas
                                    timer = timer + Tsetup + CONV_TIME[i]
                                    output_list.append([timer, 'PSTAT', i, '1'])  # add to output list
                            elif meas_list[i] == 2:  # CHRONO A
                                for y in range(CHRONOA_REPEAT):
                                    if (AUTO_SUBTRACT_A == 1 and I_CONV_TYPE[i] == 3):  # auto subtract mode, no pre samples
                                        for x in range(
                                                CHRONOA_PRE):  # presamples still occur but do not get put in FIFO in this config
                                            timer = timer + Tsetup + CONV_TIME[
                                                i]  # add to timer for each pre sample, but dont put it in FIFO since auto subtract
                                        timer = timer + CHRONOA_DELAYms  # add delay after pre samples
                                        for x in range(CHRONOA_STEP):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append([timer, 'CHRONO A', i, '3'])  # add steps to output list
                                        timer = timer + CHRONOA_DELAYms  # add delay after step samples
                                        if (CHRONOA_POST > 0):
                                            for x in range(CHRONOA_POST):
                                                timer = timer + Tsetup + CONV_TIME[i]
                                                output_list.append(
                                                    [timer, 'CHRONO A', i, '4'])  # add post pulses to output list
                                        elif (POST_PULSE_EN_A == 1):
                                            # add to list the number in STEP instead of POST
                                            for x in range(CHRONOA_STEP):
                                                timer = timer + Tsetup + CONV_TIME[i]
                                                output_list.append(
                                                    [timer, 'CHRONO A', i, '4'])  # add post STEP pulses to output list
                                        for x in range(CHRONOA_BLANK):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                    else:
                                        for x in range(CHRONOA_PRE):
                                            timer = timer + Tsetup + CONV_TIME[i]  # add to timer for each pre sample
                                            output_list.append([timer, 'CHRONO A', i, '2'])  # add pre to output list
                                        timer = timer + CHRONOA_DELAYms  # add delay after pre samples
                                        for x in range(CHRONOA_STEP):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append([timer, 'CHRONO A', i, '3'])  # add steps to output list
                                        timer = timer + CHRONOA_DELAYms  # add delay after step samples
                                        if (CHRONOA_POST > 0):
                                            for x in range(CHRONOA_POST):
                                                timer = timer + Tsetup + CONV_TIME[i]
                                                output_list.append(
                                                    [timer, 'CHRONO A', i, '4'])  # add post pulses to output list
                                        elif (POST_PULSE_EN_A == 1):
                                            # add to list the number in STEP instead of POST
                                            for x in range(CHRONOA_STEP):
                                                timer = timer + Tsetup + CONV_TIME[i]
                                                output_list.append(
                                                    [timer, 'CHRONO A', i, '4'])  # add post pulses to output list
                                        for x in range(CHRONOA_BLANK):
                                            timer = timer + Tsetup + CONV_TIME[i]
                            elif meas_list[i] == 3:
                                for y in range(CHRONOB_REPEAT):
                                    if (AUTO_SUBTRACT_B == 1 and I_CONV_TYPE[i] == 3):  # auto subtract mode, no pre samples
                                        # presamples
                                        for x in range(CHRONOB_PRE):
                                            timer = timer + Tsetup + CONV_TIME[
                                                i]  # add to timer for each pre sample, but dont put it in FIFO since auto subtract
                                        timer = timer + CHRONOB_DELAYms  # add delay after pre samples
                                        for x in range(CHRONOB_STEP):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append([timer, 'CHRONO B', i, '3'])  # add steps to output list
                                        timer = timer + CHRONOB_DELAYms  # add delay after step samples
                                        if (CHRONOB_POST > 0):
                                            for x in range(CHRONOB_POST):
                                                timer = timer + Tsetup + CONV_TIME[i]
                                                output_list.append(
                                                    [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                        elif (POST_PULSE_EN_B == 1):
                                            # add to list the number in STEP
                                            for x in range(CHRONOB_STEP):
                                                timer = timer + Tsetup + CONV_TIME[i]
                                                output_list.append(
                                                    [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                        for x in range(CHRONOB_BLANK):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                    else:
                                        for x in range(CHRONOB_PRE):
                                            timer = timer + Tsetup + CONV_TIME[i]  # add to timer for each pre sample
                                            output_list.append([timer, 'CHRONO B', i, '2'])  # add pre to output list
                                        timer = timer + CHRONOB_DELAYms  # add delay after pre samples
                                        for x in range(CHRONOB_STEP):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append([timer, 'CHRONO B', i, '3'])  # add steps to output list
                                        timer = timer + CHRONOB_DELAYms  # add delay after step samples
                                        if (CHRONOB_POST > 0):
                                            for x in range(CHRONOB_POST):
                                                timer = timer + Tsetup + CONV_TIME[i]
                                                output_list.append(
                                                    [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                        elif (POST_PULSE_EN_B == 1):
                                            # add to list the number in STEP
                                            for x in range(CHRONOB_STEP):
                                                timer = timer + Tsetup + CONV_TIME[i]
                                                output_list.append(
                                                    [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                        for x in range(CHRONOB_BLANK):
                                            timer = timer + Tsetup + CONV_TIME[i]
                            elif meas_list[i] == 4:  # Arbitrary Pulse
                                if (I_CONV_TYPE[i] == 3):  # signal + offset has 2 conversions each time
                                    for x in range(AP_STEP):
                                        if x == 0:  # first sample is taken and discarded
                                            timer = timer + Tsetup + (CONV_TIME[i] * 2)
                                        else:
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append([timer, 'AP', i, '0'])  # add offset to output list
                                            timer = timer + CONV_TIME[i]
                                            output_list.append([timer, 'AP', i, '3'])  # add steps to output list
                                    for x in range(AP_REC):
                                        if x == 0:  # first sample is taken and discarded
                                            timer = timer + Tsetup + (CONV_TIME[i] * 2)
                                        else:
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append([timer, 'AP', i, '0'])  # add offset to output list
                                            timer = timer + CONV_TIME[i]
                                            output_list.append([timer, 'AP', i, '4'])  # add recovery to output list
                                else:  # other three I_CONV_TYPES are the same
                                    for x in range(AP_STEP):
                                        if x == 0:  # first sample is taken and discarded
                                            timer = timer + Tsetup + (CONV_TIME[i])
                                        else:
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append([timer, 'AP', i, '3'])  # add steps to output list
                                    for x in range(AP_REC):
                                        if x == 0:  # first sample is taken and discarded
                                            timer = timer + Tsetup + (CONV_TIME[i])
                                        else:
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append([timer, 'AP', i, '4'])  # add recovery to output list

                            elif meas_list[i] == 6:  # temperature
                                if V_CONV_TYPE[i] == 0:
                                    if TEMP_PIN_SEL == 0:  # GPIO1 temp
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                    elif TEMP_PIN_SEL == 1:  # GPIO2 temp
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                    elif TEMP_PIN_SEL == 2:  # GPIO2 then GPIO1, no difference in tags
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                else:
                                    timer = timer + Tsetup + CONV_TIME[i]  # offset once measurement
                                    if TEMP_PIN_SEL == 0:  # GPIO1 temp
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                    elif TEMP_PIN_SEL == 1:  # GPIO2 temp
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                    elif TEMP_PIN_SEL == 2:  # GPIO2 then GPIO1, no difference in tags
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                        output_list.append([timer, 'TEMPERATURE', i, '1E'])
                            elif meas_list[i] == 7:  # voltage
                                if V_CONV_TYPE[i] == 0:
                                    if VREF_SW_VSEL == 1:  # VREF SW Voltage
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                                    if VNCP_VSEL == 1:  # VNCP Voltage
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'Negative Charge Pump Voltage', i, '1F'])
                                    if VDD_VSEL == 1:  # VDD Voltage
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'VDD Voltage', i, '1D'])
                                    if VREF_VSEL == 1:  # VREF Voltage
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                                    if VBAT_VSEL == 1:  # VBAT Voltage
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'VBAT Voltage', i, '1B'])
                                    if GPIO2_VSEL == 1:  # GPIO2 Voltage
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'GPIO2 Voltage', i, '1A'])
                                    if GPIO1_VSEL == 1:  # GPIO1 Voltage
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'GPIO1 Voltage', i, '19'])
                                    if GR1_VSEL == 1:  # GR1 Voltage
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'GR1 Voltage', i, '17'])
                                    if CE1_VSEL == 1:  # CE1 Voltage
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'CE1 Voltage', i, '15'])
                                    if RE1_VSEL == 1:  # RE1 Voltage
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'RE1 Voltage', i, '13'])
                                    if WE1_VSEL == 1:  # WE1 Voltage
                                        timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                            i]  # offset and signal measurement
                                        output_list.append([timer, 'WE1 Voltage', i, '11'])
                                else:
                                    timer = timer + Tsetup + CONV_TIME[i]  # offset once measurement
                                    if VREF_SW_VSEL == 1:  # VREF SW Voltage
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                        output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                                    if VNCP_VSEL == 1:  # VNCP Voltage
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                        output_list.append([timer, 'Negative Charge Pump Voltage', i, '1F'])
                                    if VDD_VSEL == 1:  # VDD Voltage
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                        output_list.append([timer, 'VDD Voltage', i, '1D'])
                                    if VREF_VSEL == 1:  # VREF Voltage
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                        output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                                    if VBAT_VSEL == 1:  # VBAT Voltage
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                        output_list.append([timer, 'VBAT Voltage', i, '1B'])
                                    if GPIO2_VSEL == 1:  # GPIO2 Voltage
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                        output_list.append([timer, 'GPIO2 Voltage', i, '1A'])
                                    if GPIO1_VSEL == 1:  # GPIO1 Voltage
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                        output_list.append([timer, 'GPIO1 Voltage', i, '19'])
                                    if GR1_VSEL == 1:  # GR1 Voltage
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                        output_list.append([timer, 'GR1 Voltage', i, '17'])
                                    if CE1_VSEL == 1:  # CE1 Voltage
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                        output_list.append([timer, 'CE1 Voltage', i, '15'])
                                    if RE1_VSEL == 1:  # RE1 Voltage
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                        output_list.append([timer, 'RE1 Voltage', i, '13'])
                                    if WE1_VSEL == 1:  # WE1 Voltage
                                        timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                        output_list.append([timer, 'WE1 Voltage', i, '11'])

                    sample_counter = sample_counter + 1
                    timer = timer + (SSPms-(timer%SSPms)) #next measurements dont start until end of SSP frame. Advance clock to end of SSP frame
                for i in range (2):
                    i = i+4 #m5 and m6, maybe need +5
                    if (sample_counter + 1) % Mn_SRD[i] == 0:  # start at frame 1 instead of 0
                        if meas_list[i] == 1:  # PSTAT
                            if I_CONV_TYPE[i] == 0:  # offset+current meas
                                timer = timer + Tsetup + CONV_TIME[i]  # add conversion time to the timer
                                output_list.append([timer, 'PSTAT', i, '1'])  # add to output list
                            elif I_CONV_TYPE[i] == 1:  # offset only meas
                                timer = timer + Tsetup + CONV_TIME[i]
                                output_list.append([timer, 'PSTAT', i, '0'])  # add to output list
                            elif I_CONV_TYPE[i] == 2:  # offset and signal + offset  meas
                                timer = timer + Tsetup + CONV_TIME[i]
                                output_list.append([timer, 'PSTAT', i, '0'])  # add to output list
                                timer = timer + CONV_TIME[i]
                                output_list.append([timer, 'PSTAT', i, '1'])  # add to output list
                            elif I_CONV_TYPE[i] == 3:  # offset+signal signed meas
                                timer = timer + Tsetup + CONV_TIME[i]
                                output_list.append([timer, 'PSTAT', i, '1'])  # add to output list
                        elif meas_list[i] == 2:  # CHRONO A
                            for y in range(CHRONOA_REPEAT):
                                if (AUTO_SUBTRACT_A == 1 and I_CONV_TYPE[i] == 3):  # auto subtract mode, no pre samples
                                    for x in range(
                                            CHRONOA_PRE):  # presamples still occur but do not get put in FIFO in this config
                                        timer = timer + Tsetup + CONV_TIME[
                                            i]  # add to timer for each pre sample, but dont put it in FIFO since auto subtract
                                    timer = timer + CHRONOA_DELAYms  # add delay after pre samples
                                    for x in range(CHRONOA_STEP):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'CHRONO A', i, '3'])  # add steps to output list
                                    timer = timer + CHRONOA_DELAYms  # add delay after step samples
                                    if (CHRONOA_POST > 0):
                                        for x in range(CHRONOA_POST):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO A', i, '4'])  # add post pulses to output list
                                    elif (POST_PULSE_EN_A == 1):
                                        # add to list the number in STEP instead of POST
                                        for x in range(CHRONOA_STEP):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO A', i, '4'])  # add post STEP pulses to output list
                                    for x in range(CHRONOA_BLANK):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                else:
                                    for x in range(CHRONOA_PRE):
                                        timer = timer + Tsetup + CONV_TIME[i]  # add to timer for each pre sample
                                        output_list.append([timer, 'CHRONO A', i, '2'])  # add pre to output list
                                    timer = timer + CHRONOA_DELAYms  # add delay after pre samples
                                    for x in range(CHRONOA_STEP):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'CHRONO A', i, '3'])  # add steps to output list
                                    timer = timer + CHRONOA_DELAYms  # add delay after step samples
                                    if (CHRONOA_POST > 0):
                                        for x in range(CHRONOA_POST):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO A', i, '4'])  # add post pulses to output list
                                    elif (POST_PULSE_EN_A == 1):
                                        # add to list the number in STEP instead of POST
                                        for x in range(CHRONOA_STEP):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO A', i, '4'])  # add post pulses to output list
                                    for x in range(CHRONOA_BLANK):
                                        timer = timer + Tsetup + CONV_TIME[i]
                        elif meas_list[i] == 3:
                            for y in range(CHRONOB_REPEAT):
                                if (AUTO_SUBTRACT_B == 1 and I_CONV_TYPE[i] == 3):  # auto subtract mode, no pre samples
                                    # presamples
                                    for x in range(CHRONOB_PRE):
                                        timer = timer + Tsetup + CONV_TIME[
                                            i]  # add to timer for each pre sample, but dont put it in FIFO since auto subtract
                                    timer = timer + CHRONOB_DELAYms  # add delay after pre samples
                                    for x in range(CHRONOB_STEP):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'CHRONO B', i, '3'])  # add steps to output list
                                    timer = timer + CHRONOB_DELAYms  # add delay after step samples
                                    if (CHRONOB_POST > 0):
                                        for x in range(CHRONOB_POST):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                    elif (POST_PULSE_EN_B == 1):
                                        # add to list the number in STEP
                                        for x in range(CHRONOB_STEP):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                    for x in range(CHRONOB_BLANK):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                else:
                                    for x in range(CHRONOB_PRE):
                                        timer = timer + Tsetup + CONV_TIME[i]  # add to timer for each pre sample
                                        output_list.append([timer, 'CHRONO B', i, '2'])  # add pre to output list
                                    timer = timer + CHRONOB_DELAYms  # add delay after pre samples
                                    for x in range(CHRONOB_STEP):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'CHRONO B', i, '3'])  # add steps to output list
                                    timer = timer + CHRONOB_DELAYms  # add delay after step samples
                                    if (CHRONOB_POST > 0):
                                        for x in range(CHRONOB_POST):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                    elif (POST_PULSE_EN_B == 1):
                                        # add to list the number in STEP
                                        for x in range(CHRONOB_STEP):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                    for x in range(CHRONOB_BLANK):
                                        timer = timer + Tsetup + CONV_TIME[i]
                        elif meas_list[i] == 4:  # Arbitrary Pulse
                            if (I_CONV_TYPE[i] == 3):  # signal + offset has 2 conversions each time
                                for x in range(AP_STEP):
                                    if x == 0:  # first sample is taken and discarded
                                        timer = timer + Tsetup + (CONV_TIME[i] * 2)
                                    else:
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'AP', i, '0'])  # add offset to output list
                                        timer = timer + CONV_TIME[i]
                                        output_list.append([timer, 'AP', i, '3'])  # add steps to output list
                                for x in range(AP_REC):
                                    if x == 0:  # first sample is taken and discarded
                                        timer = timer + Tsetup + (CONV_TIME[i] * 2)
                                    else:
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'AP', i, '0'])  # add offset to output list
                                        timer = timer + CONV_TIME[i]
                                        output_list.append([timer, 'AP', i, '4'])  # add recovery to output list
                            else:  # other three I_CONV_TYPES are the same
                                for x in range(AP_STEP):
                                    if x == 0:  # first sample is taken and discarded
                                        timer = timer + Tsetup + (CONV_TIME[i])
                                    else:
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'AP', i, '3'])  # add steps to output list
                                for x in range(AP_REC):
                                    if x == 0:  # first sample is taken and discarded
                                        timer = timer + Tsetup + (CONV_TIME[i])
                                    else:
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'AP', i, '4'])  # add recovery to output list

                        elif meas_list[i] == 6:  # temperature
                            if V_CONV_TYPE[i] == 0:
                                if TEMP_PIN_SEL == 0:  # GPIO1 temp
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                elif TEMP_PIN_SEL == 1:  # GPIO2 temp
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                elif TEMP_PIN_SEL == 2:  # GPIO2 then GPIO1, no difference in tags
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                            else:
                                timer = timer + Tsetup + CONV_TIME[i]  # offset once measurement
                                if TEMP_PIN_SEL == 0:  # GPIO1 temp
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                elif TEMP_PIN_SEL == 1:  # GPIO2 temp
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                elif TEMP_PIN_SEL == 2:  # GPIO2 then GPIO1, no difference in tags
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                        elif meas_list[i] == 7:  # voltage
                            if V_CONV_TYPE[i] == 0:
                                if VREF_SW_VSEL == 1:  # VREF SW Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                                if VNCP_VSEL == 1:  # VNCP Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'Negative Charge Pump Voltage', i, '1F'])
                                if VDD_VSEL == 1:  # VDD Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'VDD Voltage', i, '1D'])
                                if VREF_VSEL == 1:  # VREF Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                                if VBAT_VSEL == 1:  # VBAT Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'VBAT Voltage', i, '1B'])
                                if GPIO2_VSEL == 1:  # GPIO2 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'GPIO2 Voltage', i, '1A'])
                                if GPIO1_VSEL == 1:  # GPIO1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'GPIO1 Voltage', i, '19'])
                                if GR1_VSEL == 1:  # GR1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'GR1 Voltage', i, '17'])
                                if CE1_VSEL == 1:  # CE1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'CE1 Voltage', i, '15'])
                                if RE1_VSEL == 1:  # RE1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'RE1 Voltage', i, '13'])
                                if WE1_VSEL == 1:  # WE1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'WE1 Voltage', i, '11'])
                            else:
                                timer = timer + Tsetup + CONV_TIME[i]  # offset once measurement
                                if VREF_SW_VSEL == 1:  # VREF SW Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                                if VNCP_VSEL == 1:  # VNCP Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'Negative Charge Pump Voltage', i, '1F'])
                                if VDD_VSEL == 1:  # VDD Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'VDD Voltage', i, '1D'])
                                if VREF_VSEL == 1:  # VREF Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                                if VBAT_VSEL == 1:  # VBAT Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'VBAT Voltage', i, '1B'])
                                if GPIO2_VSEL == 1:  # GPIO2 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'GPIO2 Voltage', i, '1A'])
                                if GPIO1_VSEL == 1:  # GPIO1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'GPIO1 Voltage', i, '19'])
                                if GR1_VSEL == 1:  # GR1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'GR1 Voltage', i, '17'])
                                if CE1_VSEL == 1:  # CE1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'CE1 Voltage', i, '15'])
                                if RE1_VSEL == 1:  # RE1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'RE1 Voltage', i, '13'])
                                if WE1_VSEL == 1:  # WE1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'WE1 Voltage', i, '11'])
                sample_counter = 0
                timer = timer + (SSPms - (timer % SSPms)) #next measurements dont start until end of SSP frame. Advance clock to end of SSP frame

        else: #seq restart = 1
            while sample_counter < SAMPLE_COUNT:
                for i in range (4): #loop through first 4 meas
                    if (sample_counter + 1) % Mn_SRD[i] == 0:  # start at frame 1 instead of 0
                        if meas_list[i] == 1:  # PSTAT
                            if I_CONV_TYPE[i] == 0:  # offset+current meas
                                timer = timer + Tsetup + CONV_TIME[i]  # add conversion time to the timer
                                output_list.append([timer, 'PSTAT', i, '1'])  # add to output list
                            elif I_CONV_TYPE[i] == 1:  # offset only meas
                                timer = timer + Tsetup + CONV_TIME[i]
                                output_list.append([timer, 'PSTAT', i, '0'])  # add to output list
                            elif I_CONV_TYPE[i] == 2:  # offset and signal + offset  meas
                                timer = timer + Tsetup + CONV_TIME[i]
                                output_list.append([timer, 'PSTAT', i, '0'])  # add to output list
                                timer = timer + CONV_TIME[i]
                                output_list.append([timer, 'PSTAT', i, '1'])  # add to output list
                            elif I_CONV_TYPE[i] == 3:  # offset+signal signed meas
                                timer = timer + Tsetup + CONV_TIME[i]
                                output_list.append([timer, 'PSTAT', i, '1'])  # add to output list
                        elif meas_list[i] == 2:  # CHRONO A
                            for y in range(CHRONOA_REPEAT):
                                if (AUTO_SUBTRACT_A == 1 and I_CONV_TYPE[i] == 3):  # auto subtract mode, no pre samples
                                    for x in range(
                                            CHRONOA_PRE):  # presamples still occur but do not get put in FIFO in this config
                                        timer = timer + Tsetup + CONV_TIME[
                                            i]  # add to timer for each pre sample, but dont put it in FIFO since auto subtract
                                    timer = timer + CHRONOA_DELAYms  # add delay after pre samples
                                    for x in range(CHRONOA_STEP):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'CHRONO A', i, '3'])  # add steps to output list
                                    timer = timer + CHRONOA_DELAYms  # add delay after step samples
                                    if (CHRONOA_POST > 0):
                                        for x in range(CHRONOA_POST):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO A', i, '4'])  # add post pulses to output list
                                    elif (POST_PULSE_EN_A == 1):
                                        # add to list the number in STEP instead of POST
                                        for x in range(CHRONOA_STEP):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO A', i, '4'])  # add post STEP pulses to output list
                                    for x in range(CHRONOA_BLANK):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                else:
                                    for x in range(CHRONOA_PRE):
                                        timer = timer + Tsetup + CONV_TIME[i]  # add to timer for each pre sample
                                        output_list.append([timer, 'CHRONO A', i, '2'])  # add pre to output list
                                    timer = timer + CHRONOA_DELAYms  # add delay after pre samples
                                    for x in range(CHRONOA_STEP):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'CHRONO A', i, '3'])  # add steps to output list
                                    timer = timer + CHRONOA_DELAYms  # add delay after step samples
                                    if (CHRONOA_POST > 0):
                                        for x in range(CHRONOA_POST):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO A', i, '4'])  # add post pulses to output list
                                    elif (POST_PULSE_EN_A == 1):
                                        # add to list the number in STEP instead of POST
                                        for x in range(CHRONOA_STEP):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO A', i, '4'])  # add post pulses to output list
                                    for x in range(CHRONOA_BLANK):
                                        timer = timer + Tsetup + CONV_TIME[i]
                        elif meas_list[i] == 3:
                            for y in range(CHRONOB_REPEAT):
                                if (AUTO_SUBTRACT_B == 1 and I_CONV_TYPE[i] == 3):  # auto subtract mode, no pre samples
                                    # presamples
                                    for x in range(CHRONOB_PRE):
                                        timer = timer + Tsetup + CONV_TIME[
                                            i]  # add to timer for each pre sample, but dont put it in FIFO since auto subtract
                                    timer = timer + CHRONOB_DELAYms  # add delay after pre samples
                                    for x in range(CHRONOB_STEP):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'CHRONO B', i, '3'])  # add steps to output list
                                    timer = timer + CHRONOB_DELAYms  # add delay after step samples
                                    if (CHRONOB_POST > 0):
                                        for x in range(CHRONOB_POST):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                    elif (POST_PULSE_EN_B == 1):
                                        # add to list the number in STEP
                                        for x in range(CHRONOB_STEP):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                    for x in range(CHRONOB_BLANK):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                else:
                                    for x in range(CHRONOB_PRE):
                                        timer = timer + Tsetup + CONV_TIME[i]  # add to timer for each pre sample
                                        output_list.append([timer, 'CHRONO B', i, '2'])  # add pre to output list
                                    timer = timer + CHRONOB_DELAYms  # add delay after pre samples
                                    for x in range(CHRONOB_STEP):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'CHRONO B', i, '3'])  # add steps to output list
                                    timer = timer + CHRONOB_DELAYms  # add delay after step samples
                                    if (CHRONOB_POST > 0):
                                        for x in range(CHRONOB_POST):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                    elif (POST_PULSE_EN_B == 1):
                                        # add to list the number in STEP
                                        for x in range(CHRONOB_STEP):
                                            timer = timer + Tsetup + CONV_TIME[i]
                                            output_list.append(
                                                [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                    for x in range(CHRONOB_BLANK):
                                        timer = timer + Tsetup + CONV_TIME[i]
                        elif meas_list[i] == 4:  # Arbitrary Pulse
                            if (I_CONV_TYPE[i] == 3):  # signal + offset has 2 conversions each time
                                for x in range(AP_STEP):
                                    if x == 0:  # first sample is taken and discarded
                                        timer = timer + Tsetup + (CONV_TIME[i] * 2)
                                    else:
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'AP', i, '0'])  # add offset to output list
                                        timer = timer + CONV_TIME[i]
                                        output_list.append([timer, 'AP', i, '3'])  # add steps to output list
                                for x in range(AP_REC):
                                    if x == 0:  # first sample is taken and discarded
                                        timer = timer + Tsetup + (CONV_TIME[i] * 2)
                                    else:
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'AP', i, '0'])  # add offset to output list
                                        timer = timer + CONV_TIME[i]
                                        output_list.append([timer, 'AP', i, '4'])  # add recovery to output list
                            else:  # other three I_CONV_TYPES are the same
                                for x in range(AP_STEP):
                                    if x == 0:  # first sample is taken and discarded
                                        timer = timer + Tsetup + (CONV_TIME[i])
                                    else:
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'AP', i, '3'])  # add steps to output list
                                for x in range(AP_REC):
                                    if x == 0:  # first sample is taken and discarded
                                        timer = timer + Tsetup + (CONV_TIME[i])
                                    else:
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append([timer, 'AP', i, '4'])  # add recovery to output list

                        elif meas_list[i] == 6:  # temperature
                            if V_CONV_TYPE[i] == 0:
                                if TEMP_PIN_SEL == 0:  # GPIO1 temp
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                elif TEMP_PIN_SEL == 1:  # GPIO2 temp
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                elif TEMP_PIN_SEL == 2:  # GPIO2 then GPIO1, no difference in tags
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                            else:
                                timer = timer + Tsetup + CONV_TIME[i]  # offset once measurement
                                if TEMP_PIN_SEL == 0:  # GPIO1 temp
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                elif TEMP_PIN_SEL == 1:  # GPIO2 temp
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                elif TEMP_PIN_SEL == 2:  # GPIO2 then GPIO1, no difference in tags
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                    output_list.append([timer, 'TEMPERATURE', i, '1E'])
                        elif meas_list[i] == 7:  # voltage
                            if V_CONV_TYPE[i] == 0:
                                if VREF_SW_VSEL == 1:  # VREF SW Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                                if VNCP_VSEL == 1:  # VNCP Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'Negative Charge Pump Voltage', i, '1F'])
                                if VDD_VSEL == 1:  # VDD Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'VDD Voltage', i, '1D'])
                                if VREF_VSEL == 1:  # VREF Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                                if VBAT_VSEL == 1:  # VBAT Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'VBAT Voltage', i, '1B'])
                                if GPIO2_VSEL == 1:  # GPIO2 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'GPIO2 Voltage', i, '1A'])
                                if GPIO1_VSEL == 1:  # GPIO1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'GPIO1 Voltage', i, '19'])
                                if GR1_VSEL == 1:  # GR1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'GR1 Voltage', i, '17'])
                                if CE1_VSEL == 1:  # CE1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'CE1 Voltage', i, '15'])
                                if RE1_VSEL == 1:  # RE1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'RE1 Voltage', i, '13'])
                                if WE1_VSEL == 1:  # WE1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                        i]  # offset and signal measurement
                                    output_list.append([timer, 'WE1 Voltage', i, '11'])
                            else:
                                timer = timer + Tsetup + CONV_TIME[i]  # offset once measurement
                                if VREF_SW_VSEL == 1:  # VREF SW Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                                if VNCP_VSEL == 1:  # VNCP Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'Negative Charge Pump Voltage', i, '1F'])
                                if VDD_VSEL == 1:  # VDD Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'VDD Voltage', i, '1D'])
                                if VREF_VSEL == 1:  # VREF Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                                if VBAT_VSEL == 1:  # VBAT Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'VBAT Voltage', i, '1B'])
                                if GPIO2_VSEL == 1:  # GPIO2 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'GPIO2 Voltage', i, '1A'])
                                if GPIO1_VSEL == 1:  # GPIO1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'GPIO1 Voltage', i, '19'])
                                if GR1_VSEL == 1:  # GR1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'GR1 Voltage', i, '17'])
                                if CE1_VSEL == 1:  # CE1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'CE1 Voltage', i, '15'])
                                if RE1_VSEL == 1:  # RE1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'RE1 Voltage', i, '13'])
                                if WE1_VSEL == 1:  # WE1 Voltage
                                    timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                    output_list.append([timer, 'WE1 Voltage', i, '11'])
                sample_counter = sample_counter + 1
                timer = timer + (SSPms - (timer % SSPms)) #next measurements dont start until end of SSP frame. Advance clock to end of SSP frame
            for i in range (2):
                i = i+4 #m5 and m6
                if (sample_counter + 1) % Mn_SRD[i] == 0:  # start at frame 1 instead of 0
                    if meas_list[i] == 1:  # PSTAT
                        if I_CONV_TYPE[i] == 0:  # offset+current meas
                            timer = timer + Tsetup + CONV_TIME[i]  # add conversion time to the timer
                            output_list.append([timer, 'PSTAT', i, '1'])  # add to output list
                        elif I_CONV_TYPE[i] == 1:  # offset only meas
                            timer = timer + Tsetup + CONV_TIME[i]
                            output_list.append([timer, 'PSTAT', i, '0'])  # add to output list
                        elif I_CONV_TYPE[i] == 2:  # offset and signal + offset  meas
                            timer = timer + Tsetup + CONV_TIME[i]
                            output_list.append([timer, 'PSTAT', i, '0'])  # add to output list
                            timer = timer + CONV_TIME[i]
                            output_list.append([timer, 'PSTAT', i, '1'])  # add to output list
                        elif I_CONV_TYPE[i] == 3:  # offset+signal signed meas
                            timer = timer + Tsetup + CONV_TIME[i]
                            output_list.append([timer, 'PSTAT', i, '1'])  # add to output list
                    elif meas_list[i] == 2:  # CHRONO A
                        for y in range(CHRONOA_REPEAT):
                            if (AUTO_SUBTRACT_A == 1 and I_CONV_TYPE[i] == 3):  # auto subtract mode, no pre samples
                                for x in range(
                                        CHRONOA_PRE):  # presamples still occur but do not get put in FIFO in this config
                                    timer = timer + Tsetup + CONV_TIME[
                                        i]  # add to timer for each pre sample, but dont put it in FIFO since auto subtract
                                timer = timer + CHRONOA_DELAYms  # add delay after pre samples
                                for x in range(CHRONOA_STEP):
                                    timer = timer + Tsetup + CONV_TIME[i]
                                    output_list.append([timer, 'CHRONO A', i, '3'])  # add steps to output list
                                timer = timer + CHRONOA_DELAYms  # add delay after step samples
                                if (CHRONOA_POST > 0):
                                    for x in range(CHRONOA_POST):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append(
                                            [timer, 'CHRONO A', i, '4'])  # add post pulses to output list
                                elif (POST_PULSE_EN_A == 1):
                                    # add to list the number in STEP instead of POST
                                    for x in range(CHRONOA_STEP):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append(
                                            [timer, 'CHRONO A', i, '4'])  # add post STEP pulses to output list
                                for x in range(CHRONOA_BLANK):
                                    timer = timer + Tsetup + CONV_TIME[i]
                            else:
                                for x in range(CHRONOA_PRE):
                                    timer = timer + Tsetup + CONV_TIME[i]  # add to timer for each pre sample
                                    output_list.append([timer, 'CHRONO A', i, '2'])  # add pre to output list
                                timer = timer + CHRONOA_DELAYms  # add delay after pre samples
                                for x in range(CHRONOA_STEP):
                                    timer = timer + Tsetup + CONV_TIME[i]
                                    output_list.append([timer, 'CHRONO A', i, '3'])  # add steps to output list
                                timer = timer + CHRONOA_DELAYms  # add delay after step samples
                                if (CHRONOA_POST > 0):
                                    for x in range(CHRONOA_POST):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append(
                                            [timer, 'CHRONO A', i, '4'])  # add post pulses to output list
                                elif (POST_PULSE_EN_A == 1):
                                    # add to list the number in STEP instead of POST
                                    for x in range(CHRONOA_STEP):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append(
                                            [timer, 'CHRONO A', i, '4'])  # add post pulses to output list
                                for x in range(CHRONOA_BLANK):
                                    timer = timer + Tsetup + CONV_TIME[i]
                    elif meas_list[i] == 3:
                        for y in range(CHRONOB_REPEAT):
                            if (AUTO_SUBTRACT_B == 1 and I_CONV_TYPE[i] == 3):  # auto subtract mode, no pre samples
                                # presamples
                                for x in range(CHRONOB_PRE):
                                    timer = timer + Tsetup + CONV_TIME[
                                        i]  # add to timer for each pre sample, but dont put it in FIFO since auto subtract
                                timer = timer + CHRONOB_DELAYms  # add delay after pre samples
                                for x in range(CHRONOB_STEP):
                                    timer = timer + Tsetup + CONV_TIME[i]
                                    output_list.append([timer, 'CHRONO B', i, '3'])  # add steps to output list
                                timer = timer + CHRONOB_DELAYms  # add delay after step samples
                                if (CHRONOB_POST > 0):
                                    for x in range(CHRONOB_POST):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append(
                                            [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                elif (POST_PULSE_EN_B == 1):
                                    # add to list the number in STEP
                                    for x in range(CHRONOB_STEP):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append(
                                            [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                for x in range(CHRONOB_BLANK):
                                    timer = timer + Tsetup + CONV_TIME[i]
                            else:
                                for x in range(CHRONOB_PRE):
                                    timer = timer + Tsetup + CONV_TIME[i]  # add to timer for each pre sample
                                    output_list.append([timer, 'CHRONO B', i, '2'])  # add pre to output list
                                timer = timer + CHRONOB_DELAYms  # add delay after pre samples
                                for x in range(CHRONOB_STEP):
                                    timer = timer + Tsetup + CONV_TIME[i]
                                    output_list.append([timer, 'CHRONO B', i, '3'])  # add steps to output list
                                timer = timer + CHRONOB_DELAYms  # add delay after step samples
                                if (CHRONOB_POST > 0):
                                    for x in range(CHRONOB_POST):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append(
                                            [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                elif (POST_PULSE_EN_B == 1):
                                    # add to list the number in STEP
                                    for x in range(CHRONOB_STEP):
                                        timer = timer + Tsetup + CONV_TIME[i]
                                        output_list.append(
                                            [timer, 'CHRONO B', i, '4'])  # add post pulses to output list
                                for x in range(CHRONOB_BLANK):
                                    timer = timer + Tsetup + CONV_TIME[i]
                    elif meas_list[i] == 4:  # Arbitrary Pulse
                        if (I_CONV_TYPE[i] == 3):  # signal + offset has 2 conversions each time
                            for x in range(AP_STEP):
                                if x == 0:  # first sample is taken and discarded
                                    timer = timer + Tsetup + (CONV_TIME[i] * 2)
                                else:
                                    timer = timer + Tsetup + CONV_TIME[i]
                                    output_list.append([timer, 'AP', i, '0'])  # add offset to output list
                                    timer = timer + CONV_TIME[i]
                                    output_list.append([timer, 'AP', i, '3'])  # add steps to output list
                            for x in range(AP_REC):
                                if x == 0:  # first sample is taken and discarded
                                    timer = timer + Tsetup + (CONV_TIME[i] * 2)
                                else:
                                    timer = timer + Tsetup + CONV_TIME[i]
                                    output_list.append([timer, 'AP', i, '0'])  # add offset to output list
                                    timer = timer + CONV_TIME[i]
                                    output_list.append([timer, 'AP', i, '4'])  # add recovery to output list
                        else:  # other three I_CONV_TYPES are the same
                            for x in range(AP_STEP):
                                if x == 0:  # first sample is taken and discarded
                                    timer = timer + Tsetup + (CONV_TIME[i])
                                else:
                                    timer = timer + Tsetup + CONV_TIME[i]
                                    output_list.append([timer, 'AP', i, '3'])  # add steps to output list
                            for x in range(AP_REC):
                                if x == 0:  # first sample is taken and discarded
                                    timer = timer + Tsetup + (CONV_TIME[i])
                                else:
                                    timer = timer + Tsetup + CONV_TIME[i]
                                    output_list.append([timer, 'AP', i, '4'])  # add recovery to output list

                    elif meas_list[i] == 6:  # temperature
                        if V_CONV_TYPE[i] == 0:
                            if TEMP_PIN_SEL == 0:  # GPIO1 temp
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'TEMPERATURE', i, '1E'])
                            elif TEMP_PIN_SEL == 1:  # GPIO2 temp
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'TEMPERATURE', i, '1E'])
                            elif TEMP_PIN_SEL == 2:  # GPIO2 then GPIO1, no difference in tags
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'TEMPERATURE', i, '1E'])
                        else:
                            timer = timer + Tsetup + CONV_TIME[i]  # offset once measurement
                            if TEMP_PIN_SEL == 0:  # GPIO1 temp
                                timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                output_list.append([timer, 'TEMPERATURE', i, '1E'])
                            elif TEMP_PIN_SEL == 1:  # GPIO2 temp
                                timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                output_list.append([timer, 'TEMPERATURE', i, '1E'])
                            elif TEMP_PIN_SEL == 2:  # GPIO2 then GPIO1, no difference in tags
                                timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                output_list.append([timer, 'TEMPERATURE', i, '1E'])
                                timer = timer + Tsetup + CONV_TIME[i]  # signal measurement only
                                output_list.append([timer, 'TEMPERATURE', i, '1E'])
                    elif meas_list[i] == 7:  # voltage
                        if V_CONV_TYPE[i] == 0:
                            if VREF_SW_VSEL == 1:  # VREF SW Voltage
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                            if VNCP_VSEL == 1:  # VNCP Voltage
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'Negative Charge Pump Voltage', i, '1F'])
                            if VDD_VSEL == 1:  # VDD Voltage
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'VDD Voltage', i, '1D'])
                            if VREF_VSEL == 1:  # VREF Voltage
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                            if VBAT_VSEL == 1:  # VBAT Voltage
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'VBAT Voltage', i, '1B'])
                            if GPIO2_VSEL == 1:  # GPIO2 Voltage
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'GPIO2 Voltage', i, '1A'])
                            if GPIO1_VSEL == 1:  # GPIO1 Voltage
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'GPIO1 Voltage', i, '19'])
                            if GR1_VSEL == 1:  # GR1 Voltage
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'GR1 Voltage', i, '17'])
                            if CE1_VSEL == 1:  # CE1 Voltage
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'CE1 Voltage', i, '15'])
                            if RE1_VSEL == 1:  # RE1 Voltage
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'RE1 Voltage', i, '13'])
                            if WE1_VSEL == 1:  # WE1 Voltage
                                timer = timer + Tsetup + CONV_TIME[i] + CONV_TIME[
                                    i]  # offset and signal measurement
                                output_list.append([timer, 'WE1 Voltage', i, '11'])
                        else:
                            timer = timer + Tsetup + CONV_TIME[i]  # offset once measurement
                            if VREF_SW_VSEL == 1:  # VREF SW Voltage
                                timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                            if VNCP_VSEL == 1:  # VNCP Voltage
                                timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                output_list.append([timer, 'Negative Charge Pump Voltage', i, '1F'])
                            if VDD_VSEL == 1:  # VDD Voltage
                                timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                output_list.append([timer, 'VDD Voltage', i, '1D'])
                            if VREF_VSEL == 1:  # VREF Voltage
                                timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                output_list.append([timer, 'VREF/Switch Voltage', i, '1C'])
                            if VBAT_VSEL == 1:  # VBAT Voltage
                                timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                output_list.append([timer, 'VBAT Voltage', i, '1B'])
                            if GPIO2_VSEL == 1:  # GPIO2 Voltage
                                timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                output_list.append([timer, 'GPIO2 Voltage', i, '1A'])
                            if GPIO1_VSEL == 1:  # GPIO1 Voltage
                                timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                output_list.append([timer, 'GPIO1 Voltage', i, '19'])
                            if GR1_VSEL == 1:  # GR1 Voltage
                                timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                output_list.append([timer, 'GR1 Voltage', i, '17'])
                            if CE1_VSEL == 1:  # CE1 Voltage
                                timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                output_list.append([timer, 'CE1 Voltage', i, '15'])
                            if RE1_VSEL == 1:  # RE1 Voltage
                                timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                output_list.append([timer, 'RE1 Voltage', i, '13'])
                            if WE1_VSEL == 1:  # WE1 Voltage
                                timer = timer + Tsetup + CONV_TIME[i]  # signal only measurement
                                output_list.append([timer, 'WE1 Voltage', i, '11'])

def create_Data():
    FSR_LIST = [64, 128, 256, 512, 1024]
    OFFSET_LIST = [0, 0.1, 0.2, 0.5]
    CHRONO_DELAY_LIST = [0.0248, 0.0496, 0.0744, 0.0992, 0.124, 0.1488, 0.1736,
                         0.1984]  # used to convert bit number to value

    # PSTAT FSR/Offset
    FSR_buf = (int(reg_data[reg_addr.index('24')], 16) & 0b00000111)
    if FSR_buf > 4:
        FSR_buf = 4
    PSTAT_FSR = FSR_LIST[FSR_buf]
    PSTAT_OFFSET = OFFSET_LIST[(int(reg_data[reg_addr.index('24')], 16) & 0b01100000) >> 5]
    DACA = (int(reg_data[reg_addr.index('1A')], 16) << 2) + ((int(reg_data[reg_addr.index('1C')], 16) &0b00001100) >> 2)
    DACB = (int(reg_data[reg_addr.index('1B')], 16) << 2) + (int(reg_data[reg_addr.index('5A')], 16) & 0b00000011)
    GR1_MUX = ((int(reg_data[reg_addr.index('31')], 16) * 0b00000110)>1)
    GR1_EN = (int(reg_data[reg_addr.index('31')], 16) * 0b00000001)
    VNCP_EN = ((int(reg_data[reg_addr.index('29')], 16) * 0b01000000)>6)

    #Chrono FSR/Offset
    FSR_buf = (int(reg_data[reg_addr.index('3C')], 16) & 0b00000111)
    if FSR_buf > 4:
        FSR_buf = 4
    CHRONOA_FSR = FSR_LIST[FSR_buf]
    CHRONOA_OFFSET = OFFSET_LIST[(int(reg_data[reg_addr.index('3C')], 16) & 0b01100000) >> 5]
    CHRONOA_DELAYms = CHRONO_DELAY_LIST[(int(reg_data[reg_addr.index('37')], 16) & 0b00000111)]
    POST_PULSE_EN_A = (int(reg_data[reg_addr.index('37')], 16) & 0b00100000) >> 5  # find post pulse enable bit
    CHRONOA_POST = int(reg_data[reg_addr.index('39')], 16)  # number of chrono post samples

    FSR_buf = (int(reg_data[reg_addr.index('42')], 16) & 0b00000111)
    if FSR_buf > 4:
        FSR_buf = 4
    CHRONOB_FSR = FSR_LIST[FSR_buf]
    CHRONOB_OFFSET = OFFSET_LIST[(int(reg_data[reg_addr.index('42')], 16) & 0b01100000) >> 5]
    CHRONOB_DELAYms = CHRONO_DELAY_LIST[(int(reg_data[reg_addr.index('3D')], 16) & 0b00000111)]
    POST_PULSE_EN_A = (int(reg_data[reg_addr.index('3D')], 16) & 0b00100000) >> 5  # find post pulse enable bit
    CHRONOB_POST = int(reg_data[reg_addr.index('3F')], 16)  # number of chrono post samples
    CHRONO_AMP = int(reg_data[reg_addr.index('35')], 16) & 0b00011111

    # AP FSR/Offset
    FSR_buf = (int(reg_data[reg_addr.index('5F')], 16) & 0b00000111)
    if FSR_buf > 4:
        FSR_buf = 4
    AP_FSR = FSR_LIST[FSR_buf]
    AP_OFFSET = OFFSET_LIST[(int(reg_data[reg_addr.index('5F')], 16) & 0b01100000) >> 5]
    AP_DACA_STEP = (int(reg_data[reg_addr.index('56')], 16)<<2) + (int(reg_data[reg_addr.index('5A')], 16)>>6)
    AP_DACB_STEP = (int(reg_data[reg_addr.index('57')], 16)<<2) + ((int(reg_data[reg_addr.index('5A')], 16) & 0b00110000) >>4)
    AP_DACA_REC = (int(reg_data[reg_addr.index('58')], 16)<<2) + ((int(reg_data[reg_addr.index('5A')], 16) & 0b00001100) >>2)
    AP_DACB_REC = (int(reg_data[reg_addr.index('59')], 16)<<2) + (int(reg_data[reg_addr.index('5A')], 16) & 0b00000011)
    AP_STEP = AP_DACA_STEP-AP_DACB_STEP
    AP_REC = AP_DACA_REC-AP_DACB_REC

    for i in range(len(output_list)):
        if i == 0:
            prev_meas = 'PSTAT'
        else:
            prev_meas = output_list[i-1][1]
        if output_list[i][1] == 'PSTAT': #PSTAT
            if output_list[i][3] == '0': # offset
                value = (PSTAT_FSR * PSTAT_OFFSET) + random.random()
                count = value * 65536 / PSTAT_FSR
                count = int(count)
                b0 = count & 0b11111111
                b1 = (count & 0b1111111100000000) >> 8
                b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
                output_buf = ['{:f}'.format(value), 'nA', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
                output_list[i].extend(output_buf)
                print(output_list[i])
            else:
                value = (PSTAT_FSR * PSTAT_OFFSET) + random.random() + (PSTAT_FSR*0.1+random.random()) #only adds 10% for signal
                count = value * 65536 / PSTAT_FSR
                count = int(count)
                b0 = count & 0b11111111
                b1 = (count & 0b1111111100000000) >> 8
                b2 = (output_list[i][2] << 5) + int(output_list[i][3],16)
                output_buf = ['{:f}'.format(value), 'nA', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
                output_list[i].extend(output_buf)
                print(output_list[i])
        elif output_list[i][1] == 'CHRONO A': #CHRONO A
            if output_list[i][3] == '2': #presample
                value = (CHRONOA_FSR * CHRONOA_OFFSET) + random.random()
                count = value * 65536 / CHRONOA_FSR
                count = int(count)
                b0 = count & 0b11111111
                b1 = (count & 0b1111111100000000) >> 8
                b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
                output_buf = ['{:f}'.format(value), 'nA', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
                output_list[i].extend(output_buf)
                print(output_list[i])
            elif output_list[i][3] == '3': #step sample
                if prev_meas == 'CHRONO A' and output_list[i-1][3] == '3':
                    time = time + output_list[i][0] - output_list[i - 1][0]
                else:
                    time = CHRONOA_DELAYms
                value = (CHRONOA_FSR * CHRONOA_OFFSET) + (((CHRONO_AMP/1000)*math.e**(-(time/1000)/0.01))*10**3)
                count = value * 65536 / CHRONOA_FSR
                count = int(count)
                b0 = count & 0b11111111
                b1 = (count & 0b1111111100000000) >> 8
                b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
                output_buf = ['{:f}'.format(value), 'nA', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
                output_list[i].extend(output_buf)
                print(output_list[i])
            elif output_list[i][3] == '4': #rec sample
                if CHRONOA_POST == 0:
                    value = (CHRONOA_FSR * CHRONOA_OFFSET) + random.random()
                    count = value * 65536 / CHRONOA_FSR
                    count = int(count)
                    b0 = count & 0b11111111
                    b1 = (count & 0b1111111100000000) >> 8
                    b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
                    output_buf = ['{:f}'.format(value), 'nA', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
                    output_list[i].extend(output_buf)
                    print(output_list[i])
                else:
                    if prev_meas == 'CHRONO A' and output_list[i - 1][3] == '4':
                        time = time + output_list[i][0] - output_list[i - 1][0]
                    else:
                        time = CHRONOA_DELAYms
                    value = (CHRONOA_FSR * CHRONOA_OFFSET) - (
                                ((CHRONO_AMP / 1000) * math.e ** (-(time / 1000) / 0.01)) * 10 ** 3)
                    count = value * 65536 / CHRONOA_FSR
                    count = int(count)
                    b0 = count & 0b11111111
                    b1 = (count & 0b1111111100000000) >> 8
                    b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
                    output_buf = ['{:f}'.format(value), 'nA', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
                    output_list[i].extend(output_buf)
                    print(output_list[i])
        elif output_list[i][1] == 'CHRONO B': #CHRONO B
            if output_list[i][3] == '2': #presample
                value = (CHRONOB_FSR * CHRONOB_OFFSET) + random.random()
                count = value * 65536 / CHRONOB_FSR
                count = int(count)
                b0 = count & 0b11111111
                b1 = (count & 0b1111111100000000) >> 8
                b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
                output_buf = ['{:f}'.format(value), 'nA', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
                output_list[i].extend(output_buf)
                print(output_list[i])
            elif output_list[i][3] == '3': #step sample
                if prev_meas == 'CHRONO B' and output_list[i-1][3] == '3':
                    time = time + output_list[i][0] - output_list[i - 1][0]
                else:
                    time = CHRONOB_DELAYms
                value = (CHRONOB_FSR * CHRONOB_OFFSET) + (((CHRONO_AMP/1000)*math.e**(-(time/1000)/0.01))*10**3)
                count = value * 65536 / CHRONOB_FSR
                count = int(count)
                b0 = count & 0b11111111
                b1 = (count & 0b1111111100000000) >> 8
                b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
                output_buf = ['{:f}'.format(value), 'nA', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
                output_list[i].extend(output_buf)
                print(output_list[i])
            elif output_list[i][3] == '4': #rec sample
                if CHRONOB_POST == 0:
                    value = (CHRONOB_FSR * CHRONOB_OFFSET) + random.random()
                    count = value * 65536 / CHRONOB_FSR
                    count = int(count)
                    b0 = count & 0b11111111
                    b1 = (count & 0b1111111100000000) >> 8
                    b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
                    output_buf = ['{:f}'.format(value), 'nA', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
                    output_list[i].extend(output_buf)
                    print(output_list[i])
                else:
                    if prev_meas == 'CHRONO B' and output_list[i - 1][3] == '4':
                        time = time + output_list[i][0] - output_list[i - 1][0]
                    else:
                        time = CHRONOB_DELAYms
                    value = (CHRONOB_FSR * CHRONOB_OFFSET) - (
                                ((CHRONO_AMP / 1000) * math.e ** (-(time / 1000) / 0.01)) * 10 ** 3)
                    count = value * 65536 / CHRONOB_FSR
                    count = int(count)
                    b0 = count & 0b11111111
                    b1 = (count & 0b1111111100000000) >> 8
                    b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
                    output_buf = ['{:f}'.format(value), 'nA', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
                    output_list[i].extend(output_buf)
                    print(output_list[i])
        elif output_list[i][1] == 'AP':  # AP
            if output_list[i][3] == '3':  # step sample
                if prev_meas == 'AP' and output_list[i - 1][3] == '3':
                    time = time + output_list[i][0] - output_list[i - 1][0]
                else:
                    time = 5 #5ms delay, should handle this differently
                value = (AP_FSR * AP_OFFSET) + (
                            ((AP_STEP / 1000) * math.e ** (-(time / 1000) / 0.01)) * 10 ** 3)
                count = value * 65536 / AP_FSR
                count = int(count)
                b0 = count & 0b11111111
                b1 = (count & 0b1111111100000000) >> 8
                b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
                output_buf = ['{:f}'.format(value), 'nA', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
                output_list[i].extend(output_buf)
                print(output_list[i])
            elif output_list[i][3] == '4': #step sample
                if prev_meas == 'AP' and output_list[i-1][3] == '3':
                    time = time + output_list[i][0] - output_list[i - 1][0]
                else:
                    time = 5 # 5ms delay
                value = (AP_FSR * AP_OFFSET) + (((AP_REC/1000)*math.e**(-(time/1000)/0.01))*10**3)
                count = value * 65536 / AP_FSR
                count = int(count)
                b0 = count & 0b11111111
                b1 = (count & 0b1111111100000000) >> 8
                b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
                output_buf = ['{:f}'.format(value), 'nA', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
                output_list[i].extend(output_buf)
                print(output_list[i])
        elif output_list[i][1] == 'WE1 Voltage':  # WE1 Voltage
            value = DACA #whatever value is at DACA
            count = (value / 2560) * 65536
            count = int(count)
            b0 = count & 0b11111111
            b1 = (count & 0b1111111100000000) >> 8
            b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
            value = value / 1000
            output_buf = ['{:f}'.format(value), 'V', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
            output_list[i].extend(output_buf)
            print(output_list[i])
        elif output_list[i][1] == 'RE1 Voltage':  # RE1 Voltage
            value = DACB  # whatever value is at DACA
            count = (value / 2560) * 65536
            count = int(count)
            b0 = count & 0b11111111
            b1 = (count & 0b1111111100000000) >> 8
            b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
            value = value / 1000
            output_buf = ['{:f}'.format(value), 'V', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
            output_list[i].extend(output_buf)
            print(output_list[i])
        elif output_list[i][1] == 'CE1 Voltage':  # CE1 Voltage
            value = DACB  # whatever value is at DACA
            count = (value / 2560) * 65536
            count = int(count)
            b0 = count & 0b11111111
            b1 = (count & 0b1111111100000000) >> 8
            b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
            value = value / 1000
            output_buf = ['{:f}'.format(value), 'V', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
            output_list[i].extend(output_buf)
            print(output_list[i])
        elif output_list[i][1] == 'GR1 Voltage':  # GR1 Voltage
            if GR1_EN == 0:
                value = 0
            elif GR1_MUX == 0:
                value = DACA
            else:
                value = DACB
            count = (value / 2560) * 65536
            count = int(count)
            b0 = count & 0b11111111
            b1 = (count & 0b1111111100000000) >> 8
            b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
            value = value / 1000
            output_buf = ['{:f}'.format(value), 'V', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
            output_list[i].extend(output_buf)
            print(output_list[i])
        elif output_list[i][1] == 'GPIO1 Voltage':  # GPIO1 Voltage
            value = random.randint(0,1500) #give random value between GND and VDD
            count = (value / 2560) * 65536
            count = int(count)
            b0 = count & 0b11111111
            b1 = (count & 0b1111111100000000) >> 8
            b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
            value = value / 1000
            output_buf = ['{:f}'.format(value), 'V', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
            output_list[i].extend(output_buf)
            print(output_list[i])
        elif output_list[i][1] == 'GPIO2 Voltage':  # GPIO2 Voltage
            value = random.randint(0, 1500)  # give random value between GND and VDD
            count = (value / 2560) * 65536
            count = int(count)
            b0 = count & 0b11111111
            b1 = (count & 0b1111111100000000) >> 8
            b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
            value = value / 1000
            output_buf = ['{:f}'.format(value), 'V', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
            output_list[i].extend(output_buf)
            print(output_list[i])
        elif output_list[i][1] == 'VBAT Voltage':  # VBAT Voltage
            value = 1.536 + (3*random.random()/1000) # give random value between GND and VDD
            count = (value / (4*2560)) * 65536
            count = int(count)
            b0 = count & 0b11111111
            b1 = (count & 0b1111111100000000) >> 8
            b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
            output_buf = ['{:f}'.format(value), 'V', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
            output_list[i].extend(output_buf)
            print(output_list[i])
        elif output_list[i][1] == 'VREF/Switch Voltage':  # VREF/Switch Voltage
            value = 0.8 + (3*random.random()/1000)  # give random value between GND and VDD
            count = (value / 2560) * 65536
            count = int(count)
            b0 = count & 0b11111111
            b1 = (count & 0b1111111100000000) >> 8
            b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
            output_buf = ['{:f}'.format(value), 'V', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
            output_list[i].extend(output_buf)
            print(output_list[i])
        elif output_list[i][1] == 'VDD Voltage':  # VDD Voltage
            value = 1.8 + (3*random.random()/1000) # give random value between GND and VDD
            count = (value / 2560) * 65536
            count = int(count)
            b0 = count & 0b11111111
            b1 = (count & 0b1111111100000000) >> 8
            b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
            output_buf = ['{:f}'.format(value), 'V', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
            output_list[i].extend(output_buf)
            print(output_list[i])
        elif output_list[i][1] == 'Negative Charge Pump Voltage':  # VNCP Voltage
            if VNCP_EN == 0:
                value = 0
                count= 0
            else:
                value = DACB
                count = (value + 2560) / 65536
                count = int(count)
            b0 = count & 0b11111111
            b1 = (count & 0b1111111100000000) >> 8
            b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
            value = value / 1000
            output_buf = ['{:f}'.format(value), 'V', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
            output_list[i].extend(output_buf)
            print(output_list[i])
        elif output_list[i][1] == 'TEMPERATURE':  # TEMPERATURE
            value = 0.4 + (3 * random.random() / 1000)  # give random value between GND and VDD
            count = (value / 2560) * 65536
            count = int(count)
            b0 = count & 0b11111111
            b1 = (count & 0b1111111100000000) >> 8
            b2 = (output_list[i][2] << 5) + int(output_list[i][3], 16)
            output_buf = ['{:f}'.format(value), 'V', '{:x}'.format(b2), '{:x}'.format(b1), '{:x}'.format(b0)]
            output_list[i].extend(output_buf)
            print(output_list[i])

###################################################################
#                           MAIN
###################################################################
in_file_name = 'Sequencer_InFile.csv' #may need to update name to interface with other program
data = []
buf = []
reg_addr = []
reg_data = []
output_list = []

#open file with register addr and data
infile = open(in_file_name, 'r')

#read in the data to a list
for line in infile:
    data.append(line)

#split the list into list of lists, probably a better way to do this whole section
for i in range(len(data)):
    buf.append(data[i].split(','))

#separate the addr from data, makes it easier to index data from reg addr
for i in range(len(buf)):
    reg_addr.append(buf[i][0].strip(' \n\t\r'))
    reg_data.append(buf[i][1].strip(' \n\t\r'))
    #print(reg_addr[i])

#call subroutine to create the output list with Time, Type, Mn, Tag
Sequencer()
create_Data()

#can call another function to set values, units and bit data into the same output_list
    #This function would look at the values saved in the output_list and make up relevant data

#save output_list to output csv file
out_file_name = 'max30123_FIFO_data.csv'
outfile = open(out_file_name, "w") #this and the next 2 lines just remove previous data from file
outfile.truncate()                 #only keep one run of data, I dont think we ever want to display old data
outfile.close()                    #user clicks run, old data deleted, new data written and displayed in GUI

outfile = open(out_file_name, 'a') #open file to append
for i in range(len(output_list)):
    #line below can be modified later to write other output items from data function call
    out_str = str(output_list[i][0]) + ',' + output_list[i][1]+','+str(output_list[i][2])\
              +','+str(output_list[i][3])+',' + output_list[i][4]+',' + output_list[i][5]\
              +',' + output_list[i][6]+',' + output_list[i][7]+',' + output_list[i][8]+'\n'
    outfile.write(out_str)
outfile.close()